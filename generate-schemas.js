#!/usr/bin/env node
'use strict';

const path = require('path');
const fs = require('fs');

const REPO_ROOT = '/private/tmp/n8n-expr/n8n';
const OUTPUT_DIR = path.join(REPO_ROOT, 'json-schemas');
fs.mkdirSync(OUTPUT_DIR, { recursive: true });

function propToSchema(prop) {
  if (!prop || !prop.name || prop.type === 'notice') return null;
  
  const s = {};
  if (prop.displayName) s['x-title'] = prop.displayName;
  if (prop.description) s.description = prop.description;
  if (prop.default !== undefined) s.default = prop.default;
  if (prop.displayOptions) s['x-displayOptions'] = prop.displayOptions;
  if (prop.required) s['x-required'] = true;
  
  switch (prop.type) {
    case 'string':
    case 'hidden':
      s.type = 'string';
      if (prop.typeOptions?.password) s.format = 'password';
      if (prop.typeOptions?.rows) s['x-rows'] = prop.typeOptions.rows;
      if (prop.typeOptions?.editor) s['x-editor'] = prop.typeOptions.editor;
      break;
    case 'number':
      s.type = 'number';
      if (prop.typeOptions?.minValue !== undefined) s.minimum = prop.typeOptions.minValue;
      if (prop.typeOptions?.maxValue !== undefined) s.maximum = prop.typeOptions.maxValue;
      if (prop.typeOptions?.numberPrecision !== undefined) s['x-precision'] = prop.typeOptions.numberPrecision;
      if (prop.typeOptions?.numberStepSize !== undefined) s['x-stepSize'] = prop.typeOptions.numberStepSize;
      break;
    case 'boolean':
      s.type = 'boolean';
      break;
    case 'options':
      s.type = 'string';
      if (Array.isArray(prop.options)) {
        const validOptions = prop.options.filter(o => o && 'value' in o && o.value !== undefined);
        s.enum = validOptions.map(o => o.value);
        s['x-enumNames'] = validOptions.map(o => o.name || String(o.value));
        const descs = validOptions.map(o => o.description || '');
        if (descs.some(d => d)) s['x-enumDescriptions'] = descs;
      }
      break;
    case 'multiOptions':
      s.type = 'array';
      if (Array.isArray(prop.options)) {
        const validOptions = prop.options.filter(o => o && 'value' in o);
        s.items = { type: 'string', enum: validOptions.map(o => o.value) };
        s['x-enumNames'] = validOptions.map(o => o.name || String(o.value));
      } else {
        s.items = { type: 'string' };
      }
      break;
    case 'collection':
      s.type = 'object';
      if (Array.isArray(prop.options)) {
        s.properties = {};
        for (const sub of prop.options) {
          if (!sub || !sub.name) continue;
          const subS = propToSchema(sub);
          if (subS) s.properties[sub.name] = subS;
        }
      }
      break;
    case 'fixedCollection':
      s.type = 'object';
      s.properties = {};
      if (Array.isArray(prop.options)) {
        for (const group of prop.options) {
          if (!group || !group.name) continue;
          const multi = !!(prop.typeOptions && prop.typeOptions.multipleValues);
          const groupSchema = {};
          if (group.displayName) groupSchema['x-title'] = group.displayName;
          if (group.description) groupSchema.description = group.description;
          const itemProps = {};
          if (Array.isArray(group.values)) {
            for (const sub of group.values) {
              if (!sub || !sub.name) continue;
              const subS = propToSchema(sub);
              if (subS) itemProps[sub.name] = subS;
            }
          }
          if (multi) {
            groupSchema.type = 'array';
            groupSchema.items = { type: 'object', properties: itemProps };
          } else {
            groupSchema.type = 'object';
            groupSchema.properties = itemProps;
          }
          s.properties[group.name] = groupSchema;
        }
      }
      break;
    case 'json':
      s.oneOf = [
        { type: 'string', description: 'JSON string' },
        { type: 'object' },
        { type: 'array' }
      ];
      break;
    case 'dateTime':
      s.type = 'string';
      s.format = 'date-time';
      break;
    case 'color':
      s.type = 'string';
      s.pattern = '^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$';
      s['x-format'] = 'color';
      break;
    case 'resourceLocator':
      s.type = 'object';
      const modeValues = Array.isArray(prop.modes)
        ? prop.modes.map(m => m.name).filter(Boolean)
        : ['id', 'url', 'list'];
      s.properties = {
        __rl: { type: 'boolean', const: true },
        mode: { type: 'string', enum: modeValues },
        value: { type: 'string' }
      };
      s.required = ['mode', 'value'];
      if (Array.isArray(prop.modes)) {
        s['x-modes'] = prop.modes.map(m => ({
          name: m.name,
          displayName: m.displayName,
          type: m.type
        }));
      }
      break;
    case 'filter':
      s.type = 'object';
      s.properties = {
        conditions: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              leftValue: { type: 'string' },
              rightValue: {},
              operator: { type: 'object' }
            }
          }
        },
        combinator: { type: 'string', enum: ['and', 'or'], default: 'and' },
        options: {
          type: 'object',
          properties: {
            caseSensitive: { type: 'boolean' },
            leftValue: { type: 'string' },
            typeValidation: { type: 'string' }
          }
        }
      };
      break;
    case 'credentialsSelect':
      s.type = 'object';
      s.properties = {
        credsType: { type: 'string' },
        nodeCredentialType: { type: 'string' }
      };
      break;
    case 'assignmentCollection':
      s.type = 'object';
      s.properties = {
        assignments: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              name: { type: 'string' },
              value: {},
              type: { type: 'string', enum: ['string', 'number', 'boolean', 'object', 'array'] }
            },
            required: ['name']
          }
        }
      };
      break;
    default:
      s.type = 'string';
      s['x-n8n-type'] = prop.type;
      break;
  }
  
  return s;
}

function descToSchema(desc, versionLabel) {
  const schema = {
    '$schema': 'http://json-schema.org/draft-07/schema#',
    title: desc.displayName || desc.name,
    description: desc.description || '',
    'x-n8n-node-type': desc.name,
    'x-n8n-version': versionLabel !== undefined ? versionLabel : (desc.version || 1),
    'x-n8n-group': Array.isArray(desc.group) ? desc.group : ([desc.group].filter(Boolean)),
    type: 'object',
    properties: {}
  };
  if (desc.subtitle) schema['x-subtitle'] = desc.subtitle;
  if (desc.icon) schema['x-icon'] = desc.icon;
  if (desc.inputs) schema['x-inputs'] = desc.inputs;
  if (desc.outputs) schema['x-outputs'] = desc.outputs;
  if (desc.credentials) schema['x-credentials'] = desc.credentials;
  if (desc.webhooks) schema['x-webhooks'] = 'true';
  
  for (const prop of (desc.properties || [])) {
    if (!prop || !prop.name) continue;
    const propSchema = propToSchema(prop);
    if (propSchema !== null) {
      schema.properties[prop.name] = propSchema;
    }
  }
  return schema;
}

function safeName(str) {
  return String(str || 'unknown')
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '')
    .replace(/\s+/g, '_')
    .replace(/_{2,}/g, '_')
    .replace(/^_+|_+$/g, '')
    .trim() || 'unknown';
}

function processPackage(pkgDir, pkgName) {
  let pkg;
  try {
    pkg = JSON.parse(fs.readFileSync(path.join(pkgDir, 'package.json'), 'utf-8'));
  } catch (e) {
    console.error(`Cannot read package.json in ${pkgDir}`);
    return { success: 0, failed: 0 };
  }

  const nodeFiles = pkg.n8n?.nodes || [];
  if (nodeFiles.length === 0) {
    console.log(`No nodes found in ${pkgName}`);
    return { success: 0, failed: 0 };
  }

  console.log(`\nProcessing ${nodeFiles.length} node files from ${pkgName}...`);
  let success = 0, failed = 0;

  for (const nodeFile of nodeFiles) {
    const fullPath = path.join(pkgDir, nodeFile);
    try {
      const mod = require(fullPath);
      for (const [, NodeClass] of Object.entries(mod)) {
        if (typeof NodeClass !== 'function') continue;
        let instance;
        try { instance = new NodeClass(); } catch { continue; }

        const toProcess = [];

        if (instance.nodeVersions) {
          // VersionedNodeType
          const base = instance.baseDescription || {};
          for (const [ver, vConstructor] of Object.entries(instance.nodeVersions)) {
            let vInstance;
            try {
              vInstance = typeof vConstructor === 'function' ? new vConstructor() : vConstructor;
            } catch { vInstance = vConstructor; }
            const desc = (vInstance && vInstance.description) ? vInstance.description : null;
            if (desc && Array.isArray(desc.properties)) {
              toProcess.push({ base, desc, ver });
            }
          }
        } else if (instance.description && Array.isArray(instance.description.properties)) {
          toProcess.push({ base: null, desc: instance.description, ver: null });
        }

        for (const { base, desc, ver } of toProcess) {
          const merged = base ? { ...base, ...desc, properties: desc.properties } : desc;
          if (!merged || !merged.name) continue;

          const schema = descToSchema(merged, ver !== null ? Number(ver) : undefined);
          const vSuffix = (toProcess.length > 1 && ver !== null) ? `_v${ver}` : '';
          const fname = safeName(merged.displayName || merged.name) + vSuffix + '.json';
          fs.writeFileSync(path.join(OUTPUT_DIR, fname), JSON.stringify(schema, null, 2) + '\n');
          console.log(`  ✓ ${merged.displayName || merged.name}${vSuffix}`);
          success++;
        }
      }
    } catch (e) {
      failed++;
      if (process.env.DEBUG) console.error(`  ✗ ${nodeFile}: ${e.message}`);
    }
  }
  return { success, failed };
}

// Process both packages
const nodesBase = processPackage(
  path.join(REPO_ROOT, 'packages/nodes-base'),
  'nodes-base'
);
const langchain = processPackage(
  path.join(REPO_ROOT, 'packages/@n8n/nodes-langchain'),
  '@n8n/nodes-langchain'
);

const total = nodesBase.success + langchain.success;
const totalFailed = nodesBase.failed + langchain.failed;
console.log(`\n===== DONE =====`);
console.log(`Generated: ${total} schemas`);
console.log(`Failed:    ${totalFailed} nodes`);
console.log(`Output:    ${OUTPUT_DIR}`);
