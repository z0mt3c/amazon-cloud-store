var Hoek = require('hoek');
var crypto = require('crypto');

module.exports = {
	getRelativePath: function(root, absolutePath) {
		Hoek.assert(absolutePath.indexOf(root) === 0);
		return absolutePath.substr(root.length + 1);
	},
	checksum: function(stream, next) {
		var hash = crypto.createHash('md5');

		stream.on('data', function(data) {
			hash.update(data, 'utf8')
		});

		stream.on('end', function() {
			next(null, hash.digest('hex'));
		});
	}
};