#!/usr/bin/env python3
"""
Generate Node-RED evidence-type node files for AbraFlexi.

Usage:
    python3 tools/gen_nodes.py

Reads property definitions from PROP_BASE (php-spojenet-abraflexi/static/)
and writes one .js + .html pair per evidence type into the project root.

Each generated node exposes the following metadata on every output message:
  msg.payload             — full record (all fields, including read-only)
  msg.writablePayload     — record stripped of isWritable=false fields
  msg.summaryPayload      — record with only inSummary=true fields
  msg.schema              — per-field type/constraint map (sparse, omits defaults)
  msg.readonlyFields      — list of isWritable=false field names
  msg.mandatoryFields     — list of mandatory=true field names
  msg.gdprFields          — list of fields carrying GDPR personal data (gdprType=OSOBNI)
  msg.businessLogicFields — list of hasBusinessLogic=true field names
"""
import json, os, re, sys

PROP_BASE = os.path.join(os.path.dirname(__file__),
            '../../php-spojenet-abraflexi/static/')
OUT_BASE  = os.path.join(os.path.dirname(__file__), '../')

# (evidence_path, palette_label, icon, sub_evidence, sub_label)
TYPES = [
    # ── Sales / Purchases ────────────────────────────────────────────────────
    ('faktura-vydana',     'Faktura vydaná',      'sale.svg',             'faktura-vydana-polozka',     'Položky'),
    ('faktura-prijata',    'Faktura přijatá',     'purchase.svg',         'faktura-prijata-polozka',    'Položky'),
    ('nabidka-vydana',     'Nabídka vydaná',      'nabidka.svg',          'nabidka-vydana-polozka',     'Položky'),
    ('nabidka-prijata',    'Nabídka přijatá',     'nabidka.svg',          'nabidka-prijata-polozka',    'Položky'),
    ('poptavka-vydana',    'Poptávka vydaná',     'nabidka.svg',          'poptavka-vydana-polozka',    'Položky'),
    ('poptavka-prijata',   'Poptávka přijatá',    'nabidka.svg',          'poptavka-prijata-polozka',   'Položky'),
    ('objednavka-vydana',  'Objednávka vydaná',   'objednavka.svg',       'objednavka-vydana-polozka',  'Položky'),
    ('objednavka-prijata', 'Objednávka přijatá',  'objednavka.svg',       'objednavka-prijata-polozka', 'Položky'),
    ('pohledavka',         'Pohledávka',          'pohledavka.svg',       'pohledavka-polozka',         'Položky'),
    ('zavazek',            'Závazek',             'otherCommitment.svg',  'zavazek-polozka',            'Položky'),
    # ── Cash / Bank ──────────────────────────────────────────────────────────
    ('banka',              'Banka',               'bank.svg',             'banka-polozka',              'Položky'),
    ('bankovni-ucet',      'Bankovní účet',       'bank.svg',             None,                         None),
    ('pokladni-pohyb',     'Pokladna',            'cash.svg',             'pokladni-pohyb-polozka',     'Položky'),
    ('vzajemny-zapocet',   'Vzájemný zápočet',    'bank.svg',             None,                         None),
    # ── Warehouse / Products ─────────────────────────────────────────────────
    ('cenik',              'Ceník',               'priceList.svg',        None,                         None),
    ('skladovy-pohyb',     'Sklad. pohyb',        'sklad.svg',            'skladovy-pohyb-polozka',     'Položky'),
    # ── Internal / CRM ───────────────────────────────────────────────────────
    ('interni-doklad',     'Interní doklad',      'interni-doklad.svg',   'interni-doklad-polozka',     'Položky'),
    ('smlouva',            'Smlouva',             'smlouva.svg',          'smlouva-polozka',            'Položky'),
    ('zakazka',            'Zakázka',             'zakazka.svg',          None,                         None),
    ('majetek',            'Majetek',             'majetek.svg',          None,                         None),
    ('adresar',            'Adresář',             'adresar.svg',          None,                         None),
    ('kontakt',            'Kontakt',             'adresar.svg',          None,                         None),
]

# ── helpers ────────────────────────────────────────────────────────────────

def node_name(ev):
    return 'abraflexi-' + ev

def fn_name(ev):
    parts = ['AbraFlexi'] + [p.capitalize() for p in re.split(r'-', ev)]
    return ''.join(parts) + 'Node'

def load_props(ev):
    fname = os.path.join(PROP_BASE, f'Properties.{ev}.json')
    if not os.path.exists(fname):
        return {}
    with open(fname) as f:
        return json.load(f)

def build_metadata(props):
    """Extract all metadata lists and schema from property definitions."""
    skip = {'external-ids'}

    readonly      = []
    mandatory     = []
    summary       = []
    gdpr          = []
    business_logic = []
    schema        = {}

    for k, v in props.items():
        if k in skip or not isinstance(v, dict):
            continue

        if v.get('isWritable')     == 'false': readonly.append(k)
        if v.get('mandatory')      == 'true':  mandatory.append(k)
        if v.get('inSummary')      == 'true':  summary.append(k)
        if v.get('gdprType'):                  gdpr.append(k)
        if v.get('hasBusinessLogic') == 'true': business_logic.append(k)

        # Build sparse schema entry — omit flags that are the default (true/absent)
        entry = {'type': v.get('type', 'string')}
        if v.get('isWritable')       == 'false': entry['writable']      = False
        if v.get('mandatory')        == 'true':  entry['mandatory']     = True
        if v.get('gdprType'):                    entry['gdpr']          = True
        if v.get('hasBusinessLogic') == 'true':  entry['businessLogic'] = True
        if v.get('inSummary')        == 'true':  entry['inSummary']     = True
        if v.get('maxLength'):                   entry['maxLength']     = int(v['maxLength'])
        if v.get('minLength'):                   entry['minLength']     = int(v['minLength'])
        if v.get('decimal'):                     entry['decimal']       = int(v['decimal'])
        if v.get('digits'):                      entry['digits']        = int(v['digits'])
        if v.get('maxValue'):                    entry['maxValue']      = float(v['maxValue'])
        if v.get('minValue'):                    entry['minValue']      = float(v['minValue'])
        if v.get('fkEvidencePath'):              entry['fkEvidencePath'] = v['fkEvidencePath']

        schema[k] = entry

    return {
        'readonly':       readonly,
        'mandatory':      mandatory,
        'summary':        summary,
        'gdpr':           gdpr,
        'business_logic': business_logic,
        'schema':         schema,
    }

def compact_json(obj, indent=None):
    return json.dumps(obj, ensure_ascii=False, indent=indent)

def inline_list(lst, max_show=15):
    shown = lst[:max_show]
    doc   = ', '.join(f'<code>{k}</code>' for k in shown)
    if len(lst) > max_show:
        doc += f' … ({len(lst)} celkem)'
    return doc or '—'


# ── JS template ────────────────────────────────────────────────────────────

JS_TMPL = '''\
'use strict';

// Generated by tools/gen_nodes.py — do not edit by hand.
module.exports = function (RED) {{
    var urlModule = require('url');

    var READONLY_FIELDS       = {readonly_json};
    var MANDATORY_FIELDS      = {mandatory_json};
    var SUMMARY_FIELDS        = {summary_json};
    var GDPR_FIELDS           = {gdpr_json};
    var BUSINESS_LOGIC_FIELDS = {bl_json};
    var SCHEMA                = {schema_json};

    function fetchRecord(serverConfig, evidencePath, id, callback) {{
        var baseUrl  = serverConfig.url.replace(/\\/$/, '');
        var company  = serverConfig.company;
        var user     = serverConfig.credentials.user     || '';
        var password = serverConfig.credentials.password || '';
        var fullUrl  = baseUrl + '/c/' + company + '/' + evidencePath + '/' + id + '.json';

        var parsed   = urlModule.parse(fullUrl);
        var protocol = parsed.protocol === 'https:' ? require('https') : require('http');
        var auth     = Buffer.from(user + ':' + password).toString('base64');

        var req = protocol.request({{
            hostname:           parsed.hostname,
            port:               parsed.port,
            path:               parsed.path,
            method:             'GET',
            headers:            {{ 'Authorization': 'Basic ' + auth, 'Accept': 'application/json' }},
            rejectUnauthorized: false
        }}, function (res) {{
            var data = '';
            res.on('data', function (chunk) {{ data += chunk; }});
            res.on('end', function () {{
                if (res.statusCode >= 400) {{
                    callback(new Error('HTTP ' + res.statusCode + ' (' + fullUrl + ')'));
                    return;
                }}
                try {{ callback(null, JSON.parse(data)); }}
                catch (e) {{ callback(e); }}
            }});
        }});
        req.on('error', callback);
        req.end();
    }}

    function filterKeys(record, allowList) {{
        var out = {{}};
        allowList.forEach(function (k) {{ if (k in record) out[k] = record[k]; }});
        return out;
    }}

    function excludeKeys(record, denyList) {{
        var out = {{}};
        Object.keys(record).forEach(function (k) {{
            if (denyList.indexOf(k) === -1) out[k] = record[k];
        }});
        return out;
    }}

    function {fn_name}(config) {{
        RED.nodes.createNode(this, config);
        var node         = this;
        var serverConfig = RED.nodes.getNode(config.server);

        node.on('input', function (msg, send, done) {{
            if (!serverConfig) {{
                node.error('Není nakonfigurován AbraFlexi server', msg);
                return done();
            }}
            var id = String((msg.payload && msg.payload.id != null ? msg.payload.id : msg.id) || '').trim();
            if (!id) {{
                node.error('Chybí msg.payload.id nebo msg.id (ID záznamu)', msg);
                return done();
            }}

            node.status({{ fill: 'blue', shape: 'dot', text: 'načítám ' + id }});

            fetchRecord(serverConfig, '{ev}', id, function (err, json) {{
                if (err) {{
                    node.error(err.message, msg);
                    node.status({{ fill: 'red', shape: 'ring', text: 'chyba' }});
                    return done(err);
                }}
                var records = json.winstrom && json.winstrom['{ev}'];
                if (!records || records.length === 0) {{
                    node.warn('Záznam nenalezen: {ev}/' + id, msg);
                    node.status({{ fill: 'yellow', shape: 'ring', text: 'nenalezeno' }});
                    return done();
                }}
                var record = records[0];

                var outMsg                  = RED.util.cloneMessage(msg);
                outMsg.payload              = record;
                outMsg.writablePayload      = excludeKeys(record, READONLY_FIELDS);
                outMsg.summaryPayload       = filterKeys(record, SUMMARY_FIELDS);
                outMsg.schema               = SCHEMA;
                outMsg.readonlyFields       = READONLY_FIELDS;
                outMsg.mandatoryFields      = MANDATORY_FIELDS;
                outMsg.gdprFields           = GDPR_FIELDS;
                outMsg.businessLogicFields  = BUSINESS_LOGIC_FIELDS;
                outMsg.topic                = '{ev}';
                outMsg.abraflexi_id         = record.id || id;

                {sub_send}
                node.status({{ fill: 'green', shape: 'dot', text: record.kod || String(id) }});
                done();
            }});
        }});

        node.status({{ fill: 'grey', shape: 'ring', text: 'čeká' }});
    }}

    RED.nodes.registerType('{node_name}', {fn_name});
}};
'''

JS_SUB = '''\
var subMsg             = RED.util.cloneMessage(msg);
                subMsg.payload = record['{sub_ev}'] || [];
                subMsg.topic   = '{sub_ev}';
                send([outMsg, subMsg]);'''

JS_NO_SUB = 'send([outMsg]);'


# ── HTML template ──────────────────────────────────────────────────────────

HTML_TMPL = '''\
<!-- Generated by tools/gen_nodes.py — do not edit by hand. -->
<script type="text/javascript">
    RED.nodes.registerType('{node_name}', {{
        category:    'AbraFlexi',
        color:       '#4C90B8',
        defaults: {{
            name:   {{ value: '' }},
            server: {{ value: '', type: 'abraflexi-config', required: true }}
        }},
        inputs:       1,
        outputs:      {num_outputs},
        icon:         '{icon}',
        paletteLabel: '{label}',
        label:        function () {{ return this.name || '{label}'; }},
        labelStyle:   function () {{ return this.name ? 'node_label_italic' : ''; }},
        inputLabels:  ['trigger / id'],
        outputLabels: {output_labels}
    }});
</script>

<script type="text/html" data-template-name="{node_name}">
    <div class="form-row">
        <label for="node-input-name"><i class="fa fa-tag"></i> Název</label>
        <input type="text" id="node-input-name" placeholder="{label}">
    </div>
    <div class="form-row">
        <label for="node-input-server"><i class="fa fa-server"></i> Server</label>
        <input type="text" id="node-input-server">
    </div>
</script>

<script type="text/html" data-help-name="{node_name}">
    <p>Načte záznam <strong>{ev}</strong> z AbraFlexi podle ID.</p>

    <h3>Vstup</h3>
    <dl class="message-properties">
        <dt>payload.id <span class="property-type">string | number</span></dt>
        <dd>ID záznamu v AbraFlexi. Alternativně <code>msg.id</code>.</dd>
    </dl>

    <h3>Výstupy</h3>
    <ol class="node-ports">
        <li>Záznam
            <dl class="message-properties">
                <dt>payload <span class="property-type">object</span></dt>
                <dd>Celý záznam <code>{ev}</code> ze serveru (všechna pole včetně read-only).</dd>

                <dt>writablePayload <span class="property-type">object</span></dt>
                <dd>Záznam bez polí <em>isWritable=false</em> — bezpečné pro PUT/POST zpět do AbraFlexi.<br>
                    Vynechána pole: {readonly_doc}.</dd>

                <dt>summaryPayload <span class="property-type">object</span></dt>
                <dd>Pouze souhrnná pole (<em>inSummary=true</em>) — lehký výstup pro směrování a zobrazení.<br>
                    Pole: {summary_doc}.</dd>

                <dt>schema <span class="property-type">object</span></dt>
                <dd>Mapa polí → metadata: <code>type</code>, <code>writable</code>, <code>mandatory</code>,
                    <code>gdpr</code>, <code>businessLogic</code>, <code>maxLength</code>,
                    <code>decimal</code>, <code>fkEvidencePath</code> …
                    Lze použít k validaci před zápisem.</dd>

                <dt>readonlyFields <span class="property-type">array</span></dt>
                <dd>Seznam polí <em>isWritable=false</em> ({readonly_count} polí).</dd>

                <dt>mandatoryFields <span class="property-type">array</span></dt>
                <dd>Povinná pole pro vytvoření záznamu: {mandatory_doc}.</dd>

                <dt>gdprFields <span class="property-type">array</span></dt>
                <dd>Pole s osobními údaji (GDPR, <em>gdprType=OSOBNI</em>): {gdpr_doc}.</dd>

                <dt>businessLogicFields <span class="property-type">array</span></dt>
                <dd>Pole, jejichž změna spouští business logiku na serveru ({bl_count} polí) — při zápisu postupujte opatrně.</dd>

                <dt>topic <span class="property-type">string</span></dt>
                <dd><code>{ev}</code></dd>

                <dt>abraflexi_id <span class="property-type">string</span></dt>
                <dd>ID záznamu.</dd>
            </dl>
        </li>{sub_help}
    </ol>
</script>
'''

HTML_SUB_HELP = '''
        <li>{sub_label}
            <dl class="message-properties">
                <dt>payload <span class="property-type">array</span></dt>
                <dd>Pole položek <code>{sub_ev}</code>.</dd>
                <dt>topic <span class="property-type">string</span></dt>
                <dd><code>{sub_ev}</code></dd>
            </dl>
        </li>'''


# ── generator ──────────────────────────────────────────────────────────────

def generate(ev, label, icon, sub_ev, sub_label):
    props = load_props(ev)
    meta  = build_metadata(props)

    # JS constants — pretty-print schema, single-line arrays
    schema_json   = compact_json(meta['schema'], indent=4)
    # indent schema relative to the var declaration
    schema_json   = schema_json.replace('\n', '\n    ')
    readonly_json = compact_json(meta['readonly'])
    mandatory_json= compact_json(meta['mandatory'])
    summary_json  = compact_json(meta['summary'])
    gdpr_json     = compact_json(meta['gdpr'])
    bl_json       = compact_json(meta['business_logic'])

    sub_send = JS_SUB.format(sub_ev=sub_ev) if sub_ev else JS_NO_SUB

    js = JS_TMPL.format(
        fn_name=fn_name(ev), ev=ev, node_name=node_name(ev),
        sub_send=sub_send,
        readonly_json=readonly_json,
        mandatory_json=mandatory_json,
        summary_json=summary_json,
        gdpr_json=gdpr_json,
        bl_json=bl_json,
        schema_json=schema_json,
    )

    # HTML doc snippets
    if sub_ev:
        num_outputs   = 2
        output_labels = "['záznam', 'položky']"
        sub_help      = HTML_SUB_HELP.format(sub_ev=sub_ev, sub_label=sub_label or 'Položky')
    else:
        num_outputs   = 1
        output_labels = "['záznam']"
        sub_help      = ''

    html = HTML_TMPL.format(
        node_name=node_name(ev), ev=ev, label=label, icon=icon,
        num_outputs=num_outputs, output_labels=output_labels,
        sub_help=sub_help,
        readonly_doc=inline_list(meta['readonly']),
        summary_doc=inline_list(meta['summary']),
        mandatory_doc=inline_list(meta['mandatory']),
        gdpr_doc=inline_list(meta['gdpr']),
        readonly_count=len(meta['readonly']),
        bl_count=len(meta['business_logic']),
    )

    with open(os.path.join(OUT_BASE, node_name(ev) + '.js'),   'w') as f: f.write(js)
    with open(os.path.join(OUT_BASE, node_name(ev) + '.html'), 'w') as f: f.write(html)

    print(f'  {node_name(ev):<40} '
          f'readonly={len(meta["readonly"]):3}  mandatory={len(meta["mandatory"]):2}  '
          f'gdpr={len(meta["gdpr"]):2}  bl={len(meta["business_logic"]):3}')
    return node_name(ev)


if __name__ == '__main__':
    print(f'Generating {len(TYPES)} evidence-type nodes...')
    generated = []
    for args in TYPES:
        generated.append(generate(*args))
    print(f'\nDone — {len(generated)} nodes written to {os.path.abspath(OUT_BASE)}')
