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
		console.log('=> ' + file.path);
		var meta = {name: file.name, path: file.path, parents: [file.parent.nodeId]};

		if (config.dry) {
			return next();
		} else {
			cloudDrive.uploadFile(meta, function(error) {
				if (error) {
					console.log(error);
				}

				next(error);
			});
		}
	},
	deleteNode: function(node, next) {
		console.log('=> ' + node.name + ' (' + node.id + ')');

		if (config.dry || config.delete !== true) {
			console.log('Deletion disabled');
			return next();
		} else {
			cloudDrive.deleteNode(node.id, function(error) {
				if (error) {
					console.log(error);
				}

				next();
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

var filesInSync = [];

async.waterfall([
	internals.logStep('Initializing amazon cloud drive...', false),
	function(data, next) {
		cloudDrive.init(function(error) {
			next(error, {cd: {}});
		});
	},
	internals.logStep('Fetching folder-list from cloud drive...'),
	function(data, next) {
		cloudDrive.list({
			filters: 'kind:FOLDER'
		}, function(error, results) {
			data.cd.folder = results;
			next(error, data)
		});
	},
	internals.logStep('Fetching file-list from cloud drive...'),
	function(data, next) {
		cloudDrive.list({filters: 'kind:FILE AND contentProperties.contentType:(image*) AND createdBy:"z0mt3c_app_01"'}, function(error, results) {
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
		if (config.md5 !== true) {
			console.log('md5 disabled -> skipping')
			return next(null, data);
		}

		async.eachLimit(data.fs.files, config.parallelChecksum, internals.generateChecksum, function(error) {
			console.log('All checksums generated after ' + prettyHrtime(process.hrtime(start)));
			next(error, data);
		});
	},
	internals.logStep('Map/Create cloud-drive tree...'),
	function(data, next) {
		async.eachLimit(data.fs.directories, 1, internals.directoryLookup(data), function(error) {
			next(error, data);
		});
	},
	internals.logStep('Filtering already uploaded files...'),
	function(data, next) {
		console.log('Potential files: ' + data.fs.files.length);

		var groupedNodes = _.reduce(data.cd.files.nodes, function(memo, node) {
			_.each(node.parents, function(parentNodeId) {
				var array = memo[parentNodeId];

				if (array) {
					array.push(node);
				} else {
					memo[parentNodeId] = [node];
				}
			});

			return memo;
		}, {});

		async.filter(data.fs.files, function(file, callback) {
			var nodesWithSameParent = groupedNodes[file.parent.nodeId];

			var found = _.find(nodesWithSameParent, function(node) {
				var hasSameFilename = node.name.toLowerCase() === file.name.toLowerCase();
				var hasSameChecksum = config.md5 !== true || node.contentProperties.md5.toLowerCase() === file.checksum.toLowerCase();
				//var hasSameParent = node.parents.indexOf(file.parent.nodeId);
				return hasSameFilename && hasSameChecksum;
			});

			if (found) {
				filesInSync.push(found.id);
			}

			return callback(!found);
		}, function(results) {
			data.fs.files = results;
			console.log('Remaining files to be uploaded: ' + data.fs.files.length);

			return next(null, data);
		});
	},
	internals.logStep('List removable files...'),
	function(data, next) {
		var nodesToRemove = data.cd.files.remove = _.filter(data.cd.files.nodes, function(node) {
			return filesInSync.indexOf(node.id) === -1;
		});

		console.log('Files to be removed: ' + nodesToRemove.length);


		async.eachLimit(nodesToRemove, config.parallelDeletes, function(node, next) {
			async.retry(config.deleteRetries, function(cb) {
				internals.deleteNode(node, cb);
			}, function(error) {
				return next(error);
			});
		}, function(error) {
			next(error, data);
		});
	},
	internals.logStep('Sorting files...'),
	function(data, next) {
		data.fs.files = _.sortBy(data.fs.files, 'path');
		next(null, data);
	},
	internals.logStep('Check if any files have to be uploaded'),
	function(data, next) {
		if (data.fs.files.length < 1) {
			return next(new Error('up-to-date'));
		} else if (data.fs.files.length < 100) {
			_.each(data.fs.files, function(file) {
				console.log(file.path);
			});
		}

		next(null, data);
	},
	internals.logStep('Starting upload...'),
	function(data, next) {
		async.eachLimit(data.fs.files, config.parallelUploads, function(file, next) {
			async.retry(config.uploadRetries, function(cb) {
				internals.uploadFile(file, cb);
			}, function(error) {
				return next(error);
			});
		}, function(error) {
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
		console.log(error);
		console.log(JSON.stringify(error));

		if (error instanceof Error) {
			throw error;
		} else {
			throw new Error(JSON.stringify(error));
		}
	}

	console.log('###############################################');
	console.log('=> total duration: ' + prettyHrtime(process.hrtime(start)));
	console.log('###############################################');
});
