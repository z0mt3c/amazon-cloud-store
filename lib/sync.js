var fsTree = require('./fs-tree');
var prettyHrtime = require('pretty-hrtime');
var async = require('async');
var AmazonCloudDrive = require('./amazon-cloud-drive');
var _ = require('lodash');
var utils = require('./utils');
var fs = require('fs');
var config = require('./config');

var cloudDrive = new AmazonCloudDrive(config);

var internals = {
	directoryLookup: function(data) {
		var nodes = data.cd.folder.nodes;
		var nodeRoot = data.cd.folder.tree;

		return function(directory, next) {
			var parentDirectory = directory.parent;
			var nodeId = parentDirectory ? parentDirectory.nodeId : nodeRoot.id;

			var mappedNode = _.find(nodes, function(node) {
				return node.parents.indexOf(nodeId) !== -1 && node.name.toLowerCase() === directory.name.toLowerCase();
			});

			if (mappedNode) {
				directory.nodeId = mappedNode.id;
				console.log('directory ' + directory.name + ' mapped to nodeId: ' + mappedNode.id);
				next();
			} else {
				cloudDrive.createFolder({
					name: directory.name,
					labels: ['image-sync'],
					parents: [nodeId]
				}, function(error, result) {
					directory.nodeId = result.id;
					console.log('directory ' + directory.name + ' created (ID: ' + result.id + ')');
					next();
				});
			}
		}
	},
	uploadFile: function(file, next) {
		console.log('Start uploading: ' + file.name);
		var meta = {name: file.name, path: file.path, parents: [file.parent.nodeId]};

		if (config.dry) {
			return next();
		} else {
			cloudDrive.uploadFile(meta, function(error) {
				next(error);
			});
		}
	},
	generateChecksum: function(file, next) {
		utils.checksum(fs.createReadStream(file.path), function(error, checksum) {
			if (error) {
				return next(error);
			}
			file.checksum = checksum;
			return next(null, file);
		});
	},
	logStep: function(title, logtime) {
		return function(data, next) {
			if (logtime !== false) {
				console.log('=> Completed after: ' + prettyHrtime(process.hrtime(start)));
				console.log('');
			}

			console.log('###############################################');
			console.log('# ' + title);
			console.log('###############################################');

			if (_.isFunction(data)) {
				next = data;
				data = {};
			}

			next(null, data);
		}
	}
};

var start = process.hrtime();

async.waterfall([
	internals.logStep('Initializing amazon cloud drive...', false),
	function(data, next) {
		cloudDrive.init(function(error) {
			next(error, {cd: {}});
		});
	},
	internals.logStep('Fetching folder-list from cloud drive...'),
	function(data, next) {
		cloudDrive.list({}, function(error, results) {
			data.cd.folder = results;
			next(error, data)
		});
	},
	internals.logStep('Fetching file-list from cloud drive...'),
	function(data, next) {
		cloudDrive.list({filters: 'contentProperties.contentType:(image*)'}, function(error, results) {
			data.cd.files = results;
			return next(error, data);
		});
	},
	internals.logStep('Building local file-tree...'),
	function(data, next) {
		fsTree(config.path, function(error, result) {
			data.fs = result;
			next(error, data);
		});
	},
	internals.logStep('Filtering files...'),
	function(data, next) {
		console.log('Filtering files... before files: ' + data.fs.files.length);

		data.fs.files = _.filter(data.fs.files, function(file) {
			return config.filePattern.test(file.name);
		});

		console.log('Files filtered - remaining: ' + data.fs.files.length);

		if (data.fs.files.length < 1) {
			return next(new Error('up-to-date'));
		}

		next(null, data);
	},
	internals.logStep('Generating checksums...'),
	function(data, next) {
		async.eachLimit(data.fs.files, config.parallelChecksum, internals.generateChecksum, function(error) {
			console.log('All checksums generated after ' + prettyHrtime(process.hrtime(start)));
			next(error, data);
		});
	},
	internals.logStep('Filtering already uploaded files...'),
	function(data, next) {
		console.log('Potential files: ' + data.fs.files.length);

		data.fs.files = _.filter(data.fs.files, function(file) {
			var found = _.find(data.cd.files.nodes, function(node) {
				var hasSameFilename = node.name.toLowerCase() === file.name.toLowerCase();
				var hasSameChecksum = node.contentProperties.md5.toLowerCase() === file.checksum.toLowerCase();
				var hasSameParent = node.parents.indexOf(file.parent.nodeId);
				return hasSameFilename && hasSameChecksum && hasSameParent;
			});

			return !found;
		});

		console.log('Remaining files to be uploaded: ' + data.fs.files.length);


		if (data.fs.files.length < 1) {
			return next(new Error('up-to-date'));
		}

		return next(null, data);
	},
	internals.logStep('Map/Create cloud-drive tree...'),
	function(data, next) {
		async.eachLimit(data.fs.directories, 1, internals.directoryLookup(data), function(error) {
			next(error, data);
		});
	},
	internals.logStep('Starting upload...'),
	function(data, next) {
		async.eachLimit(data.fs.files, config.parallelUploads, internals.uploadFile, function(error) {
			next(error, data);
		});
	}
], function(error) {
	cloudDrive.end();

	console.log('');
	if (error && error.message === 'up-to-date') {
		console.log('###############################################');
		console.log('# Nothing to upload! Everyting up-to-date!')
	} else if (error) {
		throw error;
	}

	console.log('###############################################');
	console.log('=> total duration: ' + prettyHrtime(process.hrtime(start)));
	console.log('###############################################');
});