'use strict';

/**
 * Integration tests against the public FlexiBee demo server.
 * Run only when the demo server is reachable; skipped automatically otherwise.
 *
 *   ABRAFLEXI_URL=https://demo.flexibee.eu:5434
 *   ABRAFLEXI_COMPANY=demo
 *   ABRAFLEXI_USER=winstrom
 *   ABRAFLEXI_PASSWORD=winstrom
 *
 * or just: npm run test:demo
 */

const helper  = require('node-red-node-test-helper');
const https   = require('https');
const faktura = require('../abraflexi-faktura-vydana.js');
const banka   = require('../abraflexi-banka.js');
const adresar = require('../abraflexi-adresar.js');
const config  = require('../abraflexi-config.js');

helper.init(require.resolve('node-red'));

const DEMO_URL      = process.env.ABRAFLEXI_URL      || 'https://demo.flexibee.eu:5434';
const DEMO_COMPANY  = process.env.ABRAFLEXI_COMPANY  || 'demo';
const DEMO_USER     = process.env.ABRAFLEXI_USER     || 'winstrom';
const DEMO_PASSWORD = process.env.ABRAFLEXI_PASSWORD || 'winstrom';

// ── reachability check ─────────────────────────────────────────────────────

function checkReachable(cb) {
    var url    = require('url').parse(DEMO_URL + '/c/' + DEMO_COMPANY + '/faktura-vydana/1.json');
    var auth   = Buffer.from(DEMO_USER + ':' + DEMO_PASSWORD).toString('base64');
    var called = false;
    function once(v) { if (!called) { called = true; cb(v); } }
    var req = https.request({
        hostname: url.hostname, port: url.port || 5434,
        path: url.path, method: 'GET',
        headers: { 'Authorization': 'Basic ' + auth, 'Accept': 'application/json' },
        rejectUnauthorized: false, timeout: 5000
    }, function (res) { once(res.statusCode < 500); });
    req.on('error',   function () { once(false); });
    req.on('timeout', function () { req.destroy(); });
    req.end();
}

// ── shared flow builder ────────────────────────────────────────────────────

function buildFlow(nodeType, wires) {
    return [
        {
            id: 'cfg', type: 'abraflexi-config',
            url: DEMO_URL, company: DEMO_COMPANY
        },
        { id: 'n1', type: nodeType, server: 'cfg', wires: wires },
        { id: 'out1', type: 'helper' },
        { id: 'out2', type: 'helper' }
    ];
}

// ── suite ──────────────────────────────────────────────────────────────────

describe('abraflexi record nodes — demo server integration', function () {
    this.timeout(15000);

    var reachable = false;

    before(function (done) {
        helper.startServer(function () {
            checkReachable(function (ok) {
                reachable = ok;
                if (!ok) console.log('    (demo server unreachable — all tests skipped)');
                done();
            });
        });
    });
    after(function (done)   { helper.stopServer(done); });
    afterEach(function (done) { helper.unload().then(() => done()); });

    function skipIfOffline() {
        if (!reachable) this.skip();
    }

    // ── faktura-vydana ─────────────────────────────────────────────────────

    it('fetches a real issued invoice (faktura-vydana id=1)', function (done) {
        skipIfOffline.call(this);
        helper.load([faktura, config], buildFlow('abraflexi-faktura-vydana', [['out1'], ['out2']]),
            { cfg: { user: DEMO_USER, password: DEMO_PASSWORD } },
            function () {
                helper.getNode('out1').on('input', function (msg) {
                    msg.payload.should.have.property('id', '1');
                    msg.payload.should.have.property('kod');
                    msg.topic.should.equal('faktura-vydana');
                    msg.abraflexi_id.should.equal('1');

                    // metadata is populated from real record
                    msg.writablePayload.should.not.have.property('id');
                    msg.summaryPayload.should.have.property('kod');
                    msg.schema.should.have.property('kod');
                    msg.mandatoryFields.should.be.an.Array().and.not.be.empty();
                    msg.gdprFields.should.be.an.Array().and.not.be.empty();
                    msg.businessLogicFields.should.be.an.Array().and.not.be.empty();
                    msg.readonlyFields.should.containEql('id');
                    done();
                });
                helper.getNode('n1').receive({ payload: { id: '1' } });
            });
    });

    it('emits real invoice line items on output 2', function (done) {
        skipIfOffline.call(this);
        helper.load([faktura, config], buildFlow('abraflexi-faktura-vydana', [['out1'], ['out2']]),
            { cfg: { user: DEMO_USER, password: DEMO_PASSWORD } },
            function () {
                helper.getNode('out2').on('input', function (msg) {
                    msg.payload.should.be.an.Array();
                    msg.topic.should.equal('faktura-vydana-polozka');
                    done();
                });
                helper.getNode('n1').receive({ payload: { id: '1' } });
            });
    });

    // ── banka ──────────────────────────────────────────────────────────────

    it('fetches a real bank move (banka id=1)', function (done) {
        skipIfOffline.call(this);
        helper.load([banka, config], buildFlow('abraflexi-banka', [['out1'], ['out2']]),
            { cfg: { user: DEMO_USER, password: DEMO_PASSWORD } },
            function () {
                helper.getNode('out1').on('input', function (msg) {
                    msg.payload.should.have.property('id', '1');
                    msg.topic.should.equal('banka');
                    done();
                });
                helper.getNode('n1').receive({ payload: { id: '1' } });
            });
    });

    // ── adresar ────────────────────────────────────────────────────────────

    it('fetches a real address record (adresar id=21575)', function (done) {
        skipIfOffline.call(this);
        helper.load([adresar, config], buildFlow('abraflexi-adresar', [['out1']]),
            { cfg: { user: DEMO_USER, password: DEMO_PASSWORD } },
            function () {
                helper.getNode('out1').on('input', function (msg) {
                    msg.payload.should.have.property('id', '21575');
                    msg.topic.should.equal('adresar');
                    // address book always has GDPR personal-data fields
                    msg.gdprFields.should.be.an.Array().and.not.be.empty();
                    done();
                });
                helper.getNode('n1').receive({ payload: { id: '21575' } });
            });
    });

    // ── 404 from real server ───────────────────────────────────────────────

    it('handles non-existent record ID gracefully (no output message)', function (done) {
        skipIfOffline.call(this);
        helper.load([faktura, config], buildFlow('abraflexi-faktura-vydana', [['out1'], []]),
            { cfg: { user: DEMO_USER, password: DEMO_PASSWORD } },
            function () {
                let received = false;
                helper.getNode('out1').on('input', () => { received = true; });
                helper.getNode('n1').receive({ payload: { id: '9999999' } });
                setTimeout(function () {
                    received.should.equal(false);
                    done();
                }, 5000);
            });
    });
});
