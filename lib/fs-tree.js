var fs = require('fs');
var path = require('path');
var async = require('async');

module.exports = function(rootPath, next) {
	rootPath = path.normalize(rootPath);

	var files = [];
	var directories = [];
	var totalSize = 0;

	var internals = {
		createInfo: function createInfo(currentPath, parent, next) {
			fs.lstat(currentPath, function(error, stats) {
				if (error) {
					return next(error);
				}

				next(null, {
					name: path.basename(currentPath),
					path: currentPath,
					size: stats.size,
					parent: parent,
					directory: stats.isDirectory(),
					mtime: stats.mtime,
					ctime: stats.ctime,
					atime: stats.atime
				});
			});
		},
		createChildren: function createChildren(info, next) {
			var indexChildren = function(error, children) {
				if (error) {
					return next(error);
				}

				async.mapLimit(children, 20, function(child, next) {
					internals.createNode(path.join(info.path, child), info, next);
				}, function(error, mapped) {
					if (error) {
						return next(error);
					}

					info.children = mapped;
					next(null, info);
				});
			};

			fs.readdir(info.path, indexChildren);
		},
		createNode: function createNode(path, parent, next) {
			internals.createInfo(path, parent, function(error, info) {
				if (error) {
					return next(error);
				}

				if (info.directory) {
					directories.push(info);
					return internals.createChildren(info, next);
				} else {
					totalSize += info.size;
					files.push(info);
					return next(null, info);
				}
			});
		}
	};

	internals.createNode(rootPath, null, function(error, tree) {
		if (tree) {
			tree.isRoot = true;
		}

		next(error, {
			directories: directories,
			files: files,
			tree: tree,
			totalSize: totalSize
		});
	});
};
