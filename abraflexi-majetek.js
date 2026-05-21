'use strict';

module.exports = function (RED) {
    var urlModule = require('url');

    function fetchRecord(serverConfig, evidencePath, id, callback) {
        var baseUrl  = serverConfig.url.replace(/\/$/, '');
        var company  = serverConfig.company;
        var user     = serverConfig.credentials.user     || '';
        var password = serverConfig.credentials.password || '';
        var fullUrl  = baseUrl + '/c/' + company + '/' + evidencePath + '/' + id + '.json';

        var parsed   = urlModule.parse(fullUrl);
        var protocol = parsed.protocol === 'https:' ? require('https') : require('http');
        var auth     = Buffer.from(user + ':' + password).toString('base64');

        var req = protocol.request({
            hostname:           parsed.hostname,
            port:               parsed.port,
            path:               parsed.path,
            method:             'GET',
            headers:            { 'Authorization': 'Basic ' + auth, 'Accept': 'application/json' },
            rejectUnauthorized: false
        }, function (res) {
            var data = '';
            res.on('data', function (chunk) { data += chunk; });
            res.on('end', function () {
                if (res.statusCode >= 400) {
                    callback(new Error('HTTP ' + res.statusCode + ' (' + fullUrl + ')'));
                    return;
                }
                try { callback(null, JSON.parse(data)); }
                catch (e) { callback(e); }
            });
        });
        req.on('error', callback);
        req.end();
    }

    function AbraFlexiMajetekNode(config) {
        RED.nodes.createNode(this, config);
        var node         = this;
        var serverConfig = RED.nodes.getNode(config.server);

        node.on('input', function (msg, send, done) {
            if (!serverConfig) {
                node.error('Není nakonfigurován AbraFlexi server', msg);
                return done();
            }
            var id = String((msg.payload && msg.payload.id != null ? msg.payload.id : msg.id) || '').trim();
            if (!id) {
                node.error('Chybí msg.payload.id nebo msg.id (ID záznamu)', msg);
                return done();
            }

            node.status({ fill: 'blue', shape: 'dot', text: 'načítám ' + id });

            fetchRecord(serverConfig, 'majetek', id, function (err, json) {
                if (err) {
                    node.error(err.message, msg);
                    node.status({ fill: 'red', shape: 'ring', text: 'chyba' });
                    return done(err);
                }
                var records = json.winstrom && json.winstrom['majetek'];
                if (!records || records.length === 0) {
                    node.warn('Záznam nenalezen: majetek/' + id, msg);
                    node.status({ fill: 'yellow', shape: 'ring', text: 'nenalezeno' });
                    return done();
                }
                var record         = records[0];
                var outMsg         = RED.util.cloneMessage(msg);
                outMsg.payload     = record;
                outMsg.topic       = 'majetek';
                outMsg.abraflexi_id = record.id || id;
                send([outMsg]);
                node.status({ fill: 'green', shape: 'dot', text: record.kod || String(id) });
                done();
            });
        });

        node.status({ fill: 'grey', shape: 'ring', text: 'čeká' });
    }

    RED.nodes.registerType('abraflexi-majetek', AbraFlexiMajetekNode);
};
