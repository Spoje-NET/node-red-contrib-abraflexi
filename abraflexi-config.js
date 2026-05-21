'use strict';

module.exports = function (RED) {
    function AbraFlexiConfigNode(config) {
        RED.nodes.createNode(this, config);
        this.url     = (config.url || '').replace(/\/$/, '');
        this.company = config.company || '';
    }

    RED.nodes.registerType('abraflexi-config', AbraFlexiConfigNode, {
        credentials: {
            user:     { type: 'text' },
            password: { type: 'password' }
        }
    });
};
