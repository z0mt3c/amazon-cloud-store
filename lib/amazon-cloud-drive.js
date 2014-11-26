var Hoek = require('hoek');
var request = require('request');
var querystring = require('querystring');
var _ = require('lodash');
var fs = require('fs');

var Service = module.exports = function(config) {
	this.config = config;
};

Service.prototype.init = function(next) {
	var self = this;
	this._init_baseRequest();
	this.refreshToken(function(error, token) {
		self.loadEndpoints(next);
	});
};

Service.prototype._init_baseRequest = function() {
	var authorization = undefined;

	if (this.token && this.token.access_token) {
		authorization = 'Bearer ' + this.token.access_token;
	}

	this.request = request.defaults({
		gzip: true,
		json: true,
		headers: {
			'User-Agent': 'z0mt3c/sync-app/1.0.0',
			'Authorization': authorization
		}
	});
};

Service.prototype.end = function() {
	clearTimeout(this.timeout);
};

Service.prototype.setToken = function(token) {
	console.log('New access_token: ' + token.access_token.substr(0, 10) + '...');
	this.token = token;
	this._init_baseRequest();
	var self = this;

	this.timeout = setTimeout(function() {
		self.refreshToken()
	}, (token.expires_in - 600) * 1000);
};

Service.prototype.refreshToken = function(next) {
	var self = this;
	console.log('Refresh token...');

	request.post({
		url: this.config.endpoints.token,
		gzip: true,
		json: true,
		headers: {
			'User-Agent': 'z0mt3c/sync-app/1.0.0'
		},
		form: {
			grant_type: 'refresh_token',
			refresh_token: this.config.refreshToken,
			client_id: this.config.clientId,
			client_secret: this.config.clientSecret
		}
	}, function(error, response, body) {
		if (error || response.statusCode !== 200) {
			return next(error || body);
		}

		self.setToken(body);
		if (next) {
			next(error, body);
		}
	});
};

Service.prototype.loadEndpoints = function(next) {
	var self = this;
	this.request.get({
		url: this.config.endpoints.discovery
	}, function(error, response, body) {
		if (error || response.statusCode !== 200) {
			throw error || body;
		}

		self.endpoints = body;
		next(error, body);
	});
};

Service.prototype.list = function(params, next) {
	var self = this;
	var endpoint = this.getEndpoint('metadataUrl') + '/nodes?';
	var root = true;

	if (params.id) {
		root = false;
		endpoint = this.getEndpoint('metadataUrl') + 'nodes/' + params.id + '/children?';
		delete params.id;
	}

	var defaultParams = {limit: 200};
	params = Hoek.applyToDefaults(defaultParams, params || {});

	var fetch = function(results, params, completed) {
		var url = endpoint + querystring.stringify(params);

		self.request.get({
			url: url
		}, function(error, response, body) {
			if (error || response.statusCode !== 200) {
				return completed(error || body);
			}

			results = results.concat(body.data);
			console.log(results.length + ' of ' + body.count + ' nodes fetched!');

			if (body.nextToken) {
				params.startToken = body.nextToken;
				return fetch(results, params, completed);
			} else {
				return completed(error, results);
			}
		});
	};

	var buildTree = function(results) {
		_.each(results, function(entry) {
			if (entry.parents && entry.parents.length > 0) {
				entry.parentNodes = _.filter(results, function(filterNode) {
					return _.contains(entry.parents, filterNode.id);
				});

				_.each(entry.parentNodes, function(parentNode) {
					parentNode.childNodes = parentNode.childNodes || [];
					parentNode.childNodes.push(entry);
				});
			}
		});

		var tree = _.find(results, {isRoot: true});
		return {tree: tree, nodes: results};
	};

	fetch([], params, function(error, results) {
		return next(error, root ? buildTree(results) : results);
	});
};

Service.prototype.getEndpoint = function(name, next) {
	var contentUrl = Hoek.reach(this, 'endpoints.' + name);
	Hoek.assert(contentUrl, 'Endpoint for ' + name + ' not present');
	return contentUrl;
};

Service.prototype.createFolder = function(params, next) {
	var endpoint = this.getEndpoint('metadataUrl') + 'nodes';
	Hoek.assert(params.name, 'Name missing');
	params = Hoek.applyToDefaults({
		kind: 'FOLDER'
	}, params || {});

	this.request.post({
		url: endpoint,
		json: params
	}, function(error, response, body) {
		if (error || response.statusCode !== 201) {
			return next(error || body);
		} else {
			return next(error, body);
		}
	});
};

Service.prototype.uploadFile = function(params, next) {
	var defaultParams = {
		kind: 'FILE',
		contentType: 'image/jpeg'
	};

	params = Hoek.applyToDefaults(defaultParams, params || {});
	var endpoint = this.getEndpoint('contentUrl') + '/nodes?';

	this.request.post({
		url: endpoint,
		formData: {
			metadata: JSON.stringify({
				name: params.name,
				kind: params.kind,
				labels: params.labels,
				properties: params.properties,
				parents: params.parents
			}),
			content: fs.createReadStream(params.path)
		}
	}, function(error, response, body) {
		if (error || response.statusCode !== 201) {
			return next(error || body);
		} else {
			return next(error, body);
		}
	}).on('error', function(e){
		console.log(e)
		return next(e);
	}).end();
};
