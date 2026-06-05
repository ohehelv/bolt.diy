import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const serverAssetsDir = 'build/server/assets';
const clientAssetsDir = 'build/client/assets';

function readJsFiles(dir) {
  return readdirSync(dir)
    .filter((name) => name.endsWith('.js'))
    .map((name) => join(dir, name));
}

function patchOpenAIModels() {
  const bundlePath = readJsFiles(serverAssetsDir).find((filePath) => /server-build-.*\.js$/.test(filePath));

  if (!bundlePath) {
    throw new Error('server-build bundle not found');
  }

  let code = readFileSync(bundlePath, 'utf8');
  const classStart = code.indexOf('class OpenAIProvider extends BaseProvider');
  const staticStart = code.indexOf('  staticModels = [', classStart);
  const staticEnd = code.indexOf('  ];', staticStart) + '  ];'.length;

  if (classStart < 0 || staticStart < 0 || staticEnd < 0) {
    throw new Error('OpenAIProvider staticModels block not found');
  }

  const replacement = [
    '  staticModels = [',
    '    { name: "gpt-5.5", label: "GPT-5.5", provider: "OpenAI", maxTokenAllowed: 1050000, maxCompletionTokens: 128000 },',
    '    { name: "gpt-5.4", label: "GPT-5.4", provider: "OpenAI", maxTokenAllowed: 1050000, maxCompletionTokens: 128000 },',
    '    { name: "gpt-5.4-mini", label: "GPT-5.4 Mini", provider: "OpenAI", maxTokenAllowed: 400000, maxCompletionTokens: 128000 },',
    '    { name: "gpt-5.4-nano", label: "GPT-5.4 Nano", provider: "OpenAI", maxTokenAllowed: 400000, maxCompletionTokens: 128000 },',
    '    { name: "gpt-5", label: "GPT-5", provider: "OpenAI", maxTokenAllowed: 400000, maxCompletionTokens: 128000 },',
    '    { name: "gpt-5-mini", label: "GPT-5 Mini", provider: "OpenAI", maxTokenAllowed: 400000, maxCompletionTokens: 128000 },',
    '    { name: "gpt-5-nano", label: "GPT-5 Nano", provider: "OpenAI", maxTokenAllowed: 400000, maxCompletionTokens: 128000 },',
    '    { name: "chat-latest", label: "Chat Latest", provider: "OpenAI", maxTokenAllowed: 400000, maxCompletionTokens: 128000 },',
    '    { name: "gpt-4o", label: "GPT-4o", provider: "OpenAI", maxTokenAllowed: 128000, maxCompletionTokens: 4096 },',
    '    { name: "gpt-4o-mini", label: "GPT-4o Mini", provider: "OpenAI", maxTokenAllowed: 128000, maxCompletionTokens: 4096 },',
    '    { name: "o1-preview", label: "o1-preview", provider: "OpenAI", maxTokenAllowed: 128000, maxCompletionTokens: 32000 },',
    '    { name: "o1-mini", label: "o1-mini", provider: "OpenAI", maxTokenAllowed: 128000, maxCompletionTokens: 65000 }',
    '  ];',
  ].join('\n');

  code = code.slice(0, staticStart) + replacement + code.slice(staticEnd);

  if (!code.includes('OpenAI models request failed with HTTP')) {
    const fetchPattern =
      /const response = await fetch\(`https:\/\/api\.openai\.com\/v1\/models`, \{\s*headers: \{\s*Authorization: `Bearer \$\{apiKey\}`\s*\}\s*\}\);\s*const res = await response\.json\(\);/;
    const fetchReplacement = [
      'const response = await fetch(`https://api.openai.com/v1/models`, {',
      '      headers: {',
      '        Authorization: `Bearer ${apiKey}`',
      '      },',
      '      signal: AbortSignal.timeout(5000)',
      '    });',
      '    const res = await response.json().catch(() => ({}));',
      '    if (!response.ok || !Array.isArray(res.data)) {',
      '      const message = res?.error?.message || `OpenAI models request failed with HTTP ${response.status}`;',
      '      throw new Error(message);',
      '    }',
    ].join('\n    ');

    code = code.replace(fetchPattern, fetchReplacement);
  }

  code = code.replace(
    '(model) => model.object === "model" && (model.id.startsWith("gpt-") || model.id.startsWith("o") || model.id.startsWith("chatgpt-")) && !staticModelIds.includes(model.id)',
    '(model) => model.object === "model" && (model.id.startsWith("gpt-") || model.id.startsWith("o") || model.id.startsWith("chatgpt-") || model.id.startsWith("chat-")) && !staticModelIds.includes(model.id)',
  );

  writeFileSync(bundlePath, code);
  console.log(`Patched OpenAI models and dynamic discovery in ${bundlePath}`);
}

function patchReadableModelFallback(code) {
  const pattern =
    /let providerModels = \[\];\s*try \{\s*const response = await fetch\(`\/api\/models\/\$\{encodeURIComponent\(providerName\)\}`\);\s*const data2 = await response\.json\(\);\s*providerModels = data2\.modelList;\s*\} catch \(error\) \{\s*console\.error\("Error loading dynamic models for:", providerName, error\);\s*\}\s*setModelList\(\(prevModels\) => \{\s*const otherModels = prevModels\.filter\(\(model2\) => model2\.provider !== providerName\);\s*return \[\.\.\.otherModels, \.\.\.providerModels\];\s*\}\);/;

  return code.replace(
    pattern,
    [
      'let providerModels = [];',
      '      try {',
      '        const response = await fetch(`/api/models/${encodeURIComponent(providerName)}`);',
      '        if (!response.ok) {',
      '          throw new Error(`Model list request failed with HTTP ${response.status}`);',
      '        }',
      '        const data2 = await response.json();',
      '        if (!Array.isArray(data2.modelList)) {',
      '          throw new Error("Model list response did not include modelList");',
      '        }',
      '        providerModels = data2.modelList;',
      '      } catch (error) {',
      '        console.error("Error loading dynamic models for:", providerName, error);',
      '      }',
      '      setModelList((prevModels) => {',
      '        const otherModels = prevModels.filter((model2) => model2.provider !== providerName);',
      '        const fallbackModels = prevModels.filter((model2) => model2.provider === providerName);',
      '        return [...otherModels, ...(providerModels.length > 0 ? providerModels : fallbackModels)];',
      '      });',
    ].join('\n'),
  );
}

function patchMinifiedModelFallback(code) {
  const oldSnippet =
    'let At=[];try{At=(await(await fetch(`/api/models/${encodeURIComponent(st)}`)).json()).modelList}catch(tr){console.error("Error loading dynamic models for:",st,tr)}ne(tr=>[...tr.filter(un=>un.provider!==st),...At])';
  const newSnippet =
    'let At=[];try{const tr=await fetch(`/api/models/${encodeURIComponent(st)}`);if(!tr.ok)throw new Error(`Model list request failed with HTTP ${tr.status}`);const $t=await tr.json();if(!Array.isArray($t.modelList))throw new Error("Model list response did not include modelList");At=$t.modelList}catch(tr){console.error("Error loading dynamic models for:",st,tr)}ne(tr=>{const $t=tr.filter(un=>un.provider!==st),Qt=tr.filter(un=>un.provider===st);return[...$t,...(At.length>0?At:Qt)]})';

  return code.replace(oldSnippet, newSnippet);
}

function patchClientModelFallback() {
  let patched = 0;

  for (const filePath of [...readJsFiles(clientAssetsDir), ...readJsFiles(serverAssetsDir)]) {
    const original = readFileSync(filePath, 'utf8');
    let code = patchReadableModelFallback(original);
    code = patchMinifiedModelFallback(code);

    if (code !== original) {
      writeFileSync(filePath, code);
      patched += 1;
      console.log(`Patched model loading fallback in ${filePath}`);
    }
  }

  if (patched === 0) {
    throw new Error('model loading fallback patch did not match any bundle');
  }
}

patchOpenAIModels();
patchClientModelFallback();
