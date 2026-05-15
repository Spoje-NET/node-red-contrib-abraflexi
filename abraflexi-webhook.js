'use strict';

module.exports = function (RED) {
    var bodyParser   = require('body-parser');
    var cookieParser = require('cookie-parser');

    function AbraFlexiWebhookNode(config) {
        RED.nodes.createNode(this, config);
        var node = this;

        if (RED.settings.httpNodeRoot === false) {
            node.warn('node-red-contrib-abraflexi: httpNodeRoot is disabled; webhook node cannot register route');
            return;
        }

        var rawPath = (config.path || '/abraflexi/webhook').trim();
        if (rawPath[0] !== '/') { rawPath = '/' + rawPath; }
        node.path = rawPath;

        var secKey = (node.credentials.secKey || '').trim();

        var maxSize      = RED.settings.apiMaxLength || '5mb';
        var jsonParser   = bodyParser.json({ limit: maxSize });
        var urlencParser = bodyParser.urlencoded({ limit: maxSize, extended: true });

        var httpMiddleware = function (req, res, next) { next(); };
        if (RED.settings.httpNodeMiddleware) {
            if (typeof RED.settings.httpNodeMiddleware === 'function' ||
                Array.isArray(RED.settings.httpNodeMiddleware)) {
                httpMiddleware = RED.settings.httpNodeMiddleware;
            }
        }

        function handlePost(req, res) {
            if (secKey) {
                var incoming = (req.headers['x-fb-hook-seckey'] || '').trim();
                if (incoming !== secKey) {
                    res.sendStatus(403);
                    node.warn('AbraFlexi webhook: rejected request with invalid X-FB-Hook-SecKey from ' + req.ip);
                    return;
                }
            }

            // Respond immediately — AbraFlexi expects 2xx before processing continues
            res.sendStatus(200);

            var body = req.body;

            // Empty-body ping sent by AbraFlexi on webhook registration
            if (!body || typeof body !== 'object' ||
                !body.winstrom || !Array.isArray(body.winstrom.changes) ||
                body.winstrom.changes.length === 0) {
                node.status({ fill: 'yellow', shape: 'ring', text: 'ping (no changes)' });
                return;
            }

            var winstrom      = body.winstrom;
            var globalVersion = winstrom['@globalVersion'] || '';
            var changes       = winstrom.changes;
            var lastTimestamp = '';

            changes.forEach(function (change) {
                lastTimestamp = change['@timestamp'] || lastTimestamp;
                node.send({
                    _msgid:        RED.util.generateId(),
                    payload:       change,
                    topic:         change['@evidence']  || '',
                    operation:     change['@operation'] || '',
                    globalVersion: globalVersion
                });
            });

            node.status({ fill: 'green', shape: 'dot', text: lastTimestamp || ('v' + globalVersion) });
        }

        function errorHandler(err, req, res, next) {
            node.warn(err);
            res.sendStatus(500);
        }

        RED.httpNode.post(
            node.path,
            cookieParser(),
            httpMiddleware,
            jsonParser,
            urlencParser,
            handlePost,
            errorHandler
        );

        node.status({ fill: 'blue', shape: 'ring', text: 'waiting' });

        node.on('close', function (done) {
            var stack = RED.httpNode._router.stack;
            for (var i = stack.length - 1; i >= 0; i--) {
                var layer = stack[i];
                if (layer.route &&
                    layer.route.path === node.path &&
                    layer.route.methods['post']) {
                    stack.splice(i, 1);
                }
            }
            node.status({});
            done();
        });
    }

    RED.nodes.registerType('abraflexi-webhook', AbraFlexiWebhookNode, {
        credentials: {
            secKey: { type: 'password' }
        }
    });
};
