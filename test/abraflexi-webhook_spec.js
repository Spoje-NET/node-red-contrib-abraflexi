'use strict';

const helper     = require('node-red-node-test-helper');
const nodeModule = require('../abraflexi-webhook.js');
const request    = require('supertest');

helper.init(require.resolve('node-red'));

// Capture the express app that the node registers its routes on.
// In the test helper the node sees RED.httpNode === the mock's nodeApp,
// which is different from helper.server's app — so we must use this
// reference directly with supertest.
let app;
function loadNode(RED) {
    app = RED.httpNode;
    return nodeModule(RED);
}

// ── fixtures ───────────────────────────────────────────────────────────────

const CHANGES_TWO = {
    winstrom: {
        '@globalVersion': '8',
        changes: [
            {
                '@evidence':   'faktura-vydana',
                '@in-version': '3',
                '@operation':  'create',
                '@timestamp':  '2024-01-01 10:00:00.0',
                id: '42',
                'external-ids': []
            },
            {
                '@evidence':   'objednavka-prijata',
                '@in-version': '4',
                '@operation':  'update',
                '@timestamp':  '2024-01-01 10:00:01.0',
                id: '99',
                'external-ids': []
            }
        ]
    }
};

// ── helpers ────────────────────────────────────────────────────────────────

function load(flow, creds, done) {
    if (typeof creds === 'function') { done = creds; creds = {}; }
    helper.load(loadNode, flow, creds, done);
}

// ── suite ──────────────────────────────────────────────────────────────────

describe('abraflexi-webhook', function () {
    before(function (done)  { helper.startServer(done); });
    after(function (done)   { helper.stopServer(done); });
    afterEach(function (done) { helper.unload().then(() => done()); });

    // ── loading ──────────────────────────────────────────────────────────

    it('loads and exposes the configured name', function (done) {
        load([{ id: 'n1', type: 'abraflexi-webhook', name: 'Test hook', path: '/wh-1' }],
            function () {
                helper.getNode('n1').should.have.property('name', 'Test hook');
                done();
            });
    });

    // ── normal webhook: messages are emitted ─────────────────────────────

    it('emits one message per change record', function (done) {
        const flow = [
            { id: 'n1', type: 'abraflexi-webhook', path: '/wh-2', wires: [['n2']] },
            { id: 'n2', type: 'helper' }
        ];
        load(flow, function () {
            const msgs = [];
            helper.getNode('n2').on('input', function (msg) {
                msgs.push(msg);
                if (msgs.length === 2) {
                    msgs[0].topic.should.equal('faktura-vydana');
                    msgs[0].operation.should.equal('create');
                    msgs[0].globalVersion.should.equal('8');
                    msgs[0].payload.should.have.property('@evidence', 'faktura-vydana');
                    msgs[0].payload.should.have.property('id', '42');
                    msgs[1].topic.should.equal('objednavka-prijata');
                    msgs[1].operation.should.equal('update');
                    done();
                }
            });
            request(app).post('/wh-2').send(CHANGES_TWO)
                .expect(200).end(err => err && done(err));
        });
    });

    it('responds 200 before emitting messages (fast ack)', function (done) {
        load([{ id: 'n1', type: 'abraflexi-webhook', path: '/wh-3', wires: [[]] }],
            function () {
                request(app).post('/wh-3').send(CHANGES_TWO).expect(200, done);
            });
    });

    // ── registration ping ─────────────────────────────────────────────────

    it('returns 200 and emits nothing for an empty-body ping', function (done) {
        const flow = [
            { id: 'n1', type: 'abraflexi-webhook', path: '/wh-4', wires: [['n2']] },
            { id: 'n2', type: 'helper' }
        ];
        load(flow, function () {
            let received = false;
            helper.getNode('n2').on('input', () => { received = true; });
            request(app).post('/wh-4').send({}).expect(200)
                .end(err => {
                    if (err) return done(err);
                    setImmediate(() => { received.should.equal(false); done(); });
                });
        });
    });

    it('returns 200 and emits nothing for an empty changes array', function (done) {
        const flow = [
            { id: 'n1', type: 'abraflexi-webhook', path: '/wh-5', wires: [['n2']] },
            { id: 'n2', type: 'helper' }
        ];
        load(flow, function () {
            let received = false;
            helper.getNode('n2').on('input', () => { received = true; });
            request(app)
                .post('/wh-5')
                .send({ winstrom: { '@globalVersion': '1', changes: [] } })
                .expect(200)
                .end(err => {
                    if (err) return done(err);
                    setImmediate(() => { received.should.equal(false); done(); });
                });
        });
    });

    // ── secret key validation ─────────────────────────────────────────────

    it('rejects wrong secret key with HTTP 403', function (done) {
        load(
            [{ id: 'n1', type: 'abraflexi-webhook', path: '/wh-6', wires: [[]] }],
            { n1: { secKey: 'correct-secret' } },
            function () {
                request(app).post('/wh-6')
                    .set('X-FB-Hook-SecKey', 'wrong-secret')
                    .send(CHANGES_TWO)
                    .expect(403, done);
            }
        );
    });

    it('rejects missing secret key with HTTP 403', function (done) {
        load(
            [{ id: 'n1', type: 'abraflexi-webhook', path: '/wh-7', wires: [[]] }],
            { n1: { secKey: 'correct-secret' } },
            function () {
                request(app).post('/wh-7').send(CHANGES_TWO).expect(403, done);
            }
        );
    });

    it('accepts the correct secret key and emits messages', function (done) {
        const flow = [
            { id: 'n1', type: 'abraflexi-webhook', path: '/wh-8', wires: [['n2']] },
            { id: 'n2', type: 'helper' }
        ];
        load(flow, { n1: { secKey: 'correct-secret' } }, function () {
            helper.getNode('n2').on('input', msg => {
                msg.topic.should.equal('faktura-vydana');
                done();
            });
            request(app).post('/wh-8')
                .set('X-FB-Hook-SecKey', 'correct-secret')
                .send(CHANGES_TWO)
                .expect(200).end(err => err && done(err));
        });
    });

    // ── output message properties ─────────────────────────────────────────

    it('sets msg.topic from @evidence', function (done) {
        const flow = [
            { id: 'n1', type: 'abraflexi-webhook', path: '/wh-9', wires: [['n2']] },
            { id: 'n2', type: 'helper' }
        ];
        load(flow, function () {
            helper.getNode('n2').on('input', msg => {
                msg.topic.should.equal('faktura-vydana');
                done();
            });
            request(app).post('/wh-9')
                .send({ winstrom: { '@globalVersion': '1', changes: [
                    { '@evidence': 'faktura-vydana', '@operation': 'create',
                      '@timestamp': '2024-01-01 12:00:00.0', id: '1', 'external-ids': [] }
                ] } }).end(err => err && done(err));
        });
    });

    it('sets msg.operation from @operation', function (done) {
        const flow = [
            { id: 'n1', type: 'abraflexi-webhook', path: '/wh-a', wires: [['n2']] },
            { id: 'n2', type: 'helper' }
        ];
        load(flow, function () {
            helper.getNode('n2').on('input', msg => {
                msg.operation.should.equal('delete');
                done();
            });
            request(app).post('/wh-a')
                .send({ winstrom: { '@globalVersion': '2', changes: [
                    { '@evidence': 'adresar', '@operation': 'delete',
                      '@timestamp': '2024-06-01 09:00:00.0', id: '7', 'external-ids': [] }
                ] } }).end(err => err && done(err));
        });
    });

    it('sets msg.globalVersion from the winstrom envelope', function (done) {
        const flow = [
            { id: 'n1', type: 'abraflexi-webhook', path: '/wh-b', wires: [['n2']] },
            { id: 'n2', type: 'helper' }
        ];
        load(flow, function () {
            helper.getNode('n2').on('input', msg => {
                msg.globalVersion.should.equal('42');
                done();
            });
            request(app).post('/wh-b')
                .send({ winstrom: { '@globalVersion': '42', changes: [
                    { '@evidence': 'faktura-vydana', '@operation': 'create',
                      '@timestamp': '2024-01-01 10:00:00.0', id: '1', 'external-ids': [] }
                ] } }).end(err => err && done(err));
        });
    });

    // ── path normalisation ────────────────────────────────────────────────

    it('prepends a missing leading slash to the path', function (done) {
        load([{ id: 'n1', type: 'abraflexi-webhook', path: 'wh-c', wires: [[]] }],
            function () {
                request(app).post('/wh-c').send(CHANGES_TWO).expect(200, done);
            });
    });
});
