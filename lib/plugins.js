var hapiSwaggered = require('hapi-swaggered');
var hapiSwaggeredUi = require('hapi-swaggered-ui');

module.exports = function(server) {
	server.register({
		register: hapiSwaggered,
		options: {
			info: {
				title: 'Amazon Cloud Drive Client',
				description: 'Authorization and token management'
			}
		}
	}, {
		select: 'api',
		route: {
			prefix: '/swagger'
		}
	}, function(err) {
		if (err) {
			throw err;
		}
	});

	server.register({
		register: hapiSwaggeredUi,
		options: {
			title: 'Amazon Cloud Drive'
		}
	}, {
		select: 'api',
		route: {
			prefix: '/docs'
		}
	}, function(err) {
		if (err) {
			throw err;
		}
	});
};
