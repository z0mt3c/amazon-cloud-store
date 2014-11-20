var Hapi = require('hapi');
var Joi = require('joi');
var Hoek = require('hoek');
var fs = require('fs');
var config = Hoek.applyToDefaults(require('./config.json'), {
	scope: 'profile'
});
var Amazon = require('./lib/amazon');
var amazon = new Amazon(config);

var server = new Hapi.Server();

server.connection({
	port: 8500,
	labels: ['api'],
	tls: {
		key: fs.readFileSync(__dirname + '/ssl/key.pem'),
		cert: fs.readFileSync(__dirname + '/ssl/certificate.pem')
	}
});

var plugins = require('./lib/plugins');
plugins(server);

server.route({
	path: '/',
	method: 'GET',
	handler: function(request, reply) {
		reply.redirect('/login/amazon');
	}
});


server.route({
	path: '/login/amazon',
	method: 'GET',
	config: {
		tags: ['api'],
		handler: function(request, reply) {
			reply.redirect(amazon.getRedirectUrl());
		}
	}
});

server.route({
	path: '/login/amazon/cb',
	method: 'GET',
	config: {
		tags: ['api'],
		validate: {
			query: Joi.object({
				code: Joi.string().optional(),
				scope: Joi.string().optional(),
				error: Joi.string().optional(),
				error_description: Joi.string().optional()
			})
		},
		handler: function(request, reply) {
			var code = request.query.code;
			if (code) {
				amazon.authorize(code, function(error, token) {
					reply(token || error);
				});
			} else {
				return reply(request.query).code(400);
			}
		}
	}
});

server.route({
	path: '/login/amazon/refresh',
	method: 'GET',
	config: {
		tags: ['api'],
		validate: {
			query: Joi.object({
				refresh_token: Joi.string()
			})
		},
		handler: function(request, reply) {
			var refreshToken = request.query.refresh_token;
			if (refreshToken) {
				amazon.refreshToken(refreshToken, function(error, token) {
					reply(token || error);
				});
			} else {
				return reply(request.query);
			}
		}
	}
});

server.start(function() {
	console.log('started on https://localhost:8500');
});
