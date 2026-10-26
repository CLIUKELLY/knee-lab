import { test } from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
const dict=JSON.parse(readFileSync(new URL('../src/i18n/zh.json',import.meta.url),'utf8'));
// Exercise the translation function without mounting React or WebGL.
let source=readFileSync(new URL('../src/i18n/Language.tsx',import.meta.url),'utf8');
source=source.slice(source.indexOf('const dictionary'),source.indexOf('const LanguageContext')).replace('const dictionary = zh as Record<string, string>;',`const dictionary = ${JSON.stringify(dict)};`);
const compiled=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText;
const {translate}=await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);
test('English is passed through without Chinese text or unit changes',()=>{
 for(const key of Object.keys(dict))assert.equal(translate(key,'en'),key);
 assert.equal(translate('80 N','en'),'80 N');
});
test('Chinese localizes anatomy, controls, sources, and preserves whitespace',()=>{
 for(const key of ['Whole joint','Anterior pull','Protocol & limitations','Lachman-inspired anterior laxity experiment'])assert.equal(translate(key,'zh'),dict[key]);
 assert.equal(translate(' Knee flexion ','zh'),' 屈膝角度 ');
 assert.equal(translate('FEMUR','zh'),'股骨');
});
test('numeric values and React objects retain their identities in either language',()=>{
 const node={type:'mesh',props:{}};
 for(const language of ['en','zh']){
  assert.equal(translate(80,language),80);assert.equal(translate(node,language),node);assert.equal(translate(false,language),false);
 }
});
