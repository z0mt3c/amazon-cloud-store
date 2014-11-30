var Hoek = require('hoek');
var Joi = require('joi');
var argv = require('yargs').config('config').alias('v', 'config').demand(['config']).argv;

var configSchema = Joi.object().keys({
	filePattern: Joi.string().required(),
	path: Joi.string().required(),
	clientId: Joi.string().required(),
	clientSecret: Joi.string().required(),
	refreshToken: Joi.string().required()
}).options({allowUnknown: true});

Joi.assert(argv, configSchema, 'Configuration incomplete');

var config = Hoek.applyToDefaults({
	dry: false,
	md5: true,
	parallelChecksum: 5,
	parallelUploads: 5,
	uploadRetries: 2,
	filePattern: "\\.(bmp|gif|jpeg|jpg|png|raw|tif|tiff|cr2|crw|dng|srf)$",
	endpoints: {
		redirect: 'https://www.amazon.com/ap/oa',
		token: 'https://api.amazon.com/auth/o2/token',
		discovery: 'https://drive.amazonaws.com/drive/v1/account/endpoint'
	},
	callbackUrl: 'https://localhost:8500/login/amazon/cb',
	scope: 'clouddrive%3Aread%20clouddrive%3Awrite'
}, argv);

config.filePattern = new RegExp(config.filePattern, 'i');
module.exports = config;
