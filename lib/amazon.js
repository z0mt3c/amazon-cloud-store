var needle = require('needle');
var Hoek = require('hoek');

var defaults = {
	endpointEndpoint: 'https://drive.amazonaws.com/drive/v1/account/endpoint',
	redirectEndpoint: 'https://www.amazon.com/ap/oa',
	tokenEndpoint: 'https://api.amazon.com/auth/o2/token',
	scope: 'clouddrive%3Aread%20clouddrive%3Awrite',
	callbackUrl: 'https://localhost:8500/login/amazon/cb'
};

var Client = module.exports = function(config) {
	this.config = Hoek.applyToDefaults(defaults, config);
};

Client.prototype.getRedirectUrl = function() {
	return this.config.redirectEndpoint
		+ '?scope=' + this.config.scope
		+ '&redirect_uri=' + this.config.callbackUrl
		+ '&client_id=' + this.config.clientId
		+ '&response_type=code';
};

Client.prototype.authorize = function(code, next) {
	var self = this;
	var data = {
		grant_type: 'authorization_code',
		code: code,
		client_id: this.config.clientId,
		client_secret: this.config.clientSecret,
		redirect_uri: this.config.callbackUrl
	};

	needle.post(this.config.tokenEndpoint, data, {json: false, compressed: true}, function(error, resp, body) {
		self.token = body;
		next(error, body);
	});
};

Client.prototype.refreshToken = function(refreshToken, next) {
	var self = this;
	var data = {
		grant_type: 'refresh_token',
		refresh_token: refreshToken,
		client_id: this.config.clientId,
		client_secret: this.config.clientSecret
	};

	needle.post(this.config.tokenEndpoint, data, {
		json: false, compressed: true
	}, function(error, resp, body) {
		self.token = body;
		next(error, body)
	});
};

Client.prototype.getHeaders = function() {
	var headers = {
		compressed: true
	};

	if (this.token && this.token.access_token) {
		headers.Authorization = 'Bearer ' + this.token.access_token
	}

	return headers;
};

Client.prototype.loadEndpoints = function(refreshToken, next) {
	needle.get(this.config.endpointEndpoint, {
		headers: this.getHeaders(),
		compressed: true
	}, function(error, resp, body) {
		self.endpoints = body;
		next(error, body)
	});
};

Client.prototype.getMetadataEndpoint = function() {
	if (!this.endpoints || !this.endpoints.metadataUrl) {
		throw new Error('access_token missing');
	}
	return this.endpoints.metadataUrl;
};

Client.prototype.getContentEndpoint = function() {
	if (!this.endpoints || !this.endpoints.contentUrl) {
		throw new Error('access_token missing');
	}
	return this.endpoints.contentUrl;
};
