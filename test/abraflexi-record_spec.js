'use strict';

const helper  = require('node-red-node-test-helper');
const http    = require('http');
const faktura = require('../abraflexi-faktura-vydana.js');
const adresar = require('../abraflexi-adresar.js');
const banka   = require('../abraflexi-banka.js');
const config  = require('../abraflexi-config.js');

helper.init(require.resolve('node-red'));

// ── mock AbraFlexi server ──────────────────────────────────────────────────

const RECORD_FV = {
    id: '42', kod: 'FV-0001',
    datVyst: '2024-01-15', datSplat: '2024-02-15',
    popis: 'Testovací faktura',
    sumCelkem: '1210.00', mena: { '@showAs': 'CZK' },
    firma: { '@showAs': 'ACME s.r.o.' },
    'faktura-vydana-polozka': [
        { id: '1', nazev: 'Položka 1', mnozMj: '2', cenaMj: '500', sumCelkem: '1210' }
    ]
};

const RECORD_ADR = {
    id: '7', kod: 'ADR-0007',
    nazev: 'ACME s.r.o.', ulice: 'Testovací 1',
    mesto: 'Praha', psc: '10000', ic: '12345678'
};

const RECORD_BANKA = {
    id: '3', kod: 'BV-0003',
    datVyst: '2024-01-20', sumCelkem: '1210.00',
    'banka-polozka': [{ id: '1', nazev: 'Platba FV-0001' }]
};

let mockServer;
let mockPort;

function startMockServer(done) {
    mockServer = http.createServer(function (req, res) {
        res.setHeader('Content-Type', 'application/json');

        if (req.url.includes('/faktura-vydana/42.json')) {
            res.end(JSON.stringify({ winstrom: { 'faktura-vydana': [RECORD_FV] } }));
        } else if (req.url.includes('/faktura-vydana/999.json')) {
            res.end(JSON.stringify({ winstrom: { 'faktura-vydana': [] } }));
        } else if (req.url.includes('/adresar/7.json')) {
            res.end(JSON.stringify({ winstrom: { 'adresar': [RECORD_ADR] } }));
        } else if (req.url.includes('/banka/3.json')) {
            res.end(JSON.stringify({ winstrom: { 'banka': [RECORD_BANKA] } }));
        } else {
            res.statusCode = 404;
            res.end('{}');
        }
    });
    mockServer.listen(0, '127.0.0.1', function () {
        mockPort = mockServer.address().port;
        done();
    });
}

function stopMockServer(done) {
    if (mockServer) mockServer.close(done); else done();
}

// ── shared flow builder ────────────────────────────────────────────────────

function buildFlow(nodeType, nodeId, wires) {
    return [
        {
            id:      'cfg',
            type:    'abraflexi-config',
            url:     'http://127.0.0.1:' + mockPort,
            company: 'testfirma'
        },
        { id: nodeId, type: nodeType, server: 'cfg', wires: wires },
        { id: 'out1', type: 'helper' },
        { id: 'out2', type: 'helper' }
    ];
}

// ── suite ──────────────────────────────────────────────────────────────────

describe('abraflexi record nodes', function () {
    before(function (done) {
        helper.startServer(function () { startMockServer(done); });
    });
    after(function (done) {
        stopMockServer(function () { helper.stopServer(done); });
    });
    afterEach(function (done) { helper.unload().then(() => done()); });

    // ── loading ────────────────────────────────────────────────────────────

    it('abraflexi-faktura-vydana: loads successfully', function (done) {
        helper.load([faktura, config], buildFlow('abraflexi-faktura-vydana', 'n1', [['out1'], ['out2']]),
            function () {
                helper.getNode('n1').should.have.property('type', 'abraflexi-faktura-vydana');
                done();
            });
    });

    // ── fetching & payload ─────────────────────────────────────────────────

    it('abraflexi-faktura-vydana: emits full record on output 1', function (done) {
        helper.load([faktura, config], buildFlow('abraflexi-faktura-vydana', 'n1', [['out1'], ['out2']]),
            function () {
                helper.getNode('out1').on('input', function (msg) {
                    msg.payload.should.have.property('kod', 'FV-0001');
                    msg.payload.should.have.property('sumCelkem', '1210.00');
                    msg.topic.should.equal('faktura-vydana');
                    msg.abraflexi_id.should.equal('42');
                    done();
                });
                helper.getNode('n1').receive({ payload: { id: '42' } });
            });
    });

    it('abraflexi-faktura-vydana: emits line items on output 2', function (done) {
        helper.load([faktura, config], buildFlow('abraflexi-faktura-vydana', 'n1', [['out1'], ['out2']]),
            function () {
                helper.getNode('out2').on('input', function (msg) {
                    msg.payload.should.be.an.Array();
                    msg.payload.length.should.equal(1);
                    msg.payload[0].should.have.property('nazev', 'Položka 1');
                    msg.topic.should.equal('faktura-vydana-polozka');
                    done();
                });
                helper.getNode('n1').receive({ payload: { id: '42' } });
            });
    });

    it('abraflexi-faktura-vydana: accepts id from msg.id (not only msg.payload.id)', function (done) {
        helper.load([faktura, config], buildFlow('abraflexi-faktura-vydana', 'n1', [['out1'], []]),
            function () {
                helper.getNode('out1').on('input', function (msg) {
                    msg.payload.should.have.property('id', '42');
                    done();
                });
                helper.getNode('n1').receive({ id: '42' });
            });
    });

    // ── metadata properties ────────────────────────────────────────────────

    it('abraflexi-faktura-vydana: emits writablePayload without read-only fields', function (done) {
        helper.load([faktura, config], buildFlow('abraflexi-faktura-vydana', 'n1', [['out1'], []]),
            function () {
                helper.getNode('out1').on('input', function (msg) {
                    msg.should.have.property('writablePayload');
                    msg.writablePayload.should.not.have.property('id');
                    msg.writablePayload.should.not.have.property('lastUpdate');
                    msg.writablePayload.should.have.property('kod', 'FV-0001');
                    done();
                });
                helper.getNode('n1').receive({ payload: { id: '42' } });
            });
    });

    it('abraflexi-faktura-vydana: emits summaryPayload with only inSummary fields', function (done) {
        helper.load([faktura, config], buildFlow('abraflexi-faktura-vydana', 'n1', [['out1'], []]),
            function () {
                helper.getNode('out1').on('input', function (msg) {
                    msg.should.have.property('summaryPayload');
                    msg.summaryPayload.should.have.property('kod', 'FV-0001');
                    msg.summaryPayload.should.have.property('sumCelkem', '1210.00');
                    done();
                });
                helper.getNode('n1').receive({ payload: { id: '42' } });
            });
    });

    it('abraflexi-faktura-vydana: emits schema object with field metadata', function (done) {
        helper.load([faktura, config], buildFlow('abraflexi-faktura-vydana', 'n1', [['out1'], []]),
            function () {
                helper.getNode('out1').on('input', function (msg) {
                    msg.should.have.property('schema');
                    msg.schema.should.have.property('kod');
                    msg.schema.kod.should.have.property('type', 'string');
                    msg.schema.kod.should.have.property('maxLength');
                    msg.schema.should.have.property('id');
                    msg.schema.id.writable.should.equal(false);
                    done();
                });
                helper.getNode('n1').receive({ payload: { id: '42' } });
            });
    });

    it('abraflexi-faktura-vydana: emits mandatoryFields array', function (done) {
        helper.load([faktura, config], buildFlow('abraflexi-faktura-vydana', 'n1', [['out1'], []]),
            function () {
                helper.getNode('out1').on('input', function (msg) {
                    msg.should.have.property('mandatoryFields');
                    msg.mandatoryFields.should.be.an.Array();
                    msg.mandatoryFields.should.containEql('typDokl');
                    done();
                });
                helper.getNode('n1').receive({ payload: { id: '42' } });
            });
    });

    it('abraflexi-faktura-vydana: emits gdprFields array with personal data fields', function (done) {
        helper.load([faktura, config], buildFlow('abraflexi-faktura-vydana', 'n1', [['out1'], []]),
            function () {
                helper.getNode('out1').on('input', function (msg) {
                    msg.should.have.property('gdprFields');
                    msg.gdprFields.should.be.an.Array();
                    msg.gdprFields.length.should.be.greaterThan(0);
                    msg.gdprFields.should.containEql('kontaktEmail');
                    done();
                });
                helper.getNode('n1').receive({ payload: { id: '42' } });
            });
    });

    it('abraflexi-faktura-vydana: emits businessLogicFields array', function (done) {
        helper.load([faktura, config], buildFlow('abraflexi-faktura-vydana', 'n1', [['out1'], []]),
            function () {
                helper.getNode('out1').on('input', function (msg) {
                    msg.should.have.property('businessLogicFields');
                    msg.businessLogicFields.should.be.an.Array();
                    msg.businessLogicFields.length.should.be.greaterThan(0);
                    done();
                });
                helper.getNode('n1').receive({ payload: { id: '42' } });
            });
    });

    it('abraflexi-faktura-vydana: emits readonlyFields array', function (done) {
        helper.load([faktura, config], buildFlow('abraflexi-faktura-vydana', 'n1', [['out1'], []]),
            function () {
                helper.getNode('out1').on('input', function (msg) {
                    msg.should.have.property('readonlyFields');
                    msg.readonlyFields.should.be.an.Array();
                    msg.readonlyFields.should.containEql('id');
                    msg.readonlyFields.should.containEql('lastUpdate');
                    done();
                });
                helper.getNode('n1').receive({ payload: { id: '42' } });
            });
    });

    // ── not-found handling ─────────────────────────────────────────────────

    it('abraflexi-faktura-vydana: emits no message when record not found', function (done) {
        helper.load([faktura, config], buildFlow('abraflexi-faktura-vydana', 'n1', [['out1'], []]),
            function () {
                let received = false;
                helper.getNode('out1').on('input', () => { received = true; });
                helper.getNode('n1').receive({ payload: { id: '999' } });
                setImmediate(() => setTimeout(() => {
                    received.should.equal(false);
                    done();
                }, 200));
            });
    });

    // ── missing config ─────────────────────────────────────────────────────

    it('abraflexi-faktura-vydana: errors when server config is missing', function (done) {
        const flow = [
            { id: 'n1', type: 'abraflexi-faktura-vydana', server: '', wires: [['out1'], []] },
            { id: 'out1', type: 'helper' }
        ];
        helper.load([faktura, config], flow, function () {
            let errored = false;
            helper.getNode('n1').on('call:error', () => { errored = true; });
            helper.getNode('n1').receive({ payload: { id: '42' } });
            setImmediate(() => {
                errored.should.equal(true);
                done();
            });
        });
    });

    // ── missing id ─────────────────────────────────────────────────────────

    it('abraflexi-faktura-vydana: errors when id is missing', function (done) {
        helper.load([faktura, config], buildFlow('abraflexi-faktura-vydana', 'n1', [['out1'], []]),
            function () {
                let errored = false;
                helper.getNode('n1').on('call:error', () => { errored = true; });
                helper.getNode('n1').receive({ payload: {} });
                setImmediate(() => {
                    errored.should.equal(true);
                    done();
                });
            });
    });

    // ── other node types ───────────────────────────────────────────────────

    it('abraflexi-adresar: loads and fetches record without sub-items output', function (done) {
        helper.load([adresar, config], buildFlow('abraflexi-adresar', 'n1', [['out1']]),
            function () {
                helper.getNode('out1').on('input', function (msg) {
                    msg.payload.should.have.property('nazev', 'ACME s.r.o.');
                    msg.topic.should.equal('adresar');
                    msg.gdprFields.should.be.an.Array();
                    msg.gdprFields.length.should.be.greaterThan(0);
                    done();
                });
                helper.getNode('n1').receive({ payload: { id: '7' } });
            });
    });

    it('abraflexi-banka: emits bank record and items on separate outputs', function (done) {
        helper.load([banka, config], buildFlow('abraflexi-banka', 'n1', [['out1'], ['out2']]),
            function () {
                let record = null, items = null;
                helper.getNode('out1').on('input', function (msg) {
                    record = msg;
                    if (record && items) check();
                });
                helper.getNode('out2').on('input', function (msg) {
                    items = msg;
                    if (record && items) check();
                });
                function check() {
                    record.payload.should.have.property('kod', 'BV-0003');
                    items.payload.should.be.an.Array();
                    items.payload[0].should.have.property('nazev', 'Platba FV-0001');
                    done();
                }
                helper.getNode('n1').receive({ payload: { id: '3' } });
            });
    });
});
