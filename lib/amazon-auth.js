var request = require('request');

var Client = module.exports = function(config) {
	this.config = config
};

Client.prototype.getRedirectUrl = function() {
	return this.config.endpoints.redirect
		+ '?scope=' + this.config.scope
		+ '&redirect_uri=' + this.config.callbackUrl
		+ '&client_id=' + this.config.clientId
		+ '&response_type=code';
};

Client.prototype.authorize = function(code, next) {
	var data = {
		grant_type: 'authorization_code',
		code: code,
		client_id: this.config.clientId,
		client_secret: this.config.clientSecret,
		redirect_uri: this.config.callbackUrl
	};

	request.post({url: this.config.endpoints.token, form: data, json: true, gzip: true}, function(error, response, body) {
		if (error || response.statusCode !== 200) {
			return next(error || body);
		}

		return next(error, body);
	});
};
