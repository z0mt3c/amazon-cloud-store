var Hapi = require('hapi')
var Joi = require('joi')
var config = require('./config')
var AmazonAuth = require('./amazon-auth')
var amazon = new AmazonAuth(config)
var server = new Hapi.Server()
var pem = require('pem')

pem.createCertificate({days: 1, selfSigned: true}, function (err, keys) {
  if (err) throw err
  server.connection({
    port: 8500,
    labels: ['api'],
    tls: {
      key: keys.serviceKey,
      cert: keys.certificate
    }
  })

  server.route({
    path: '/',
    method: 'GET',
    handler: function (request, reply) {
      reply.redirect('/login/amazon')
    }
  })

  server.route({
    path: '/login/amazon',
    method: 'GET',
    config: {
      tags: ['api'],
      handler: function (request, reply) {
        reply.redirect(amazon.getRedirectUrl())
      }
    }
  })

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
      handler: function (request, reply) {
        var code = request.query.code
        if (code) {
          amazon.authorize(code, function (error, token) {
            reply(token || error)
          })
        } else {
          return reply(request.query).code(400)
        }
      }
    }
  })

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
      handler: function (request, reply) {
        var refreshToken = request.query.refresh_token
        if (refreshToken) {
          amazon.refreshToken(refreshToken, function (error, token) {
            reply(token || error)
          })
        } else {
          return reply(request.query)
        }
      }
    }
  })

  server.start(function () {
    console.log('started on https://localhost:8500')
  })
})
