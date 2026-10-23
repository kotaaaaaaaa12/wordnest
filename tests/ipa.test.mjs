import test from 'node:test';
import assert from 'node:assert/strict';
import {validateSet,normalizeIpa,normalizeIpaData,ipaItalicRanges,ipaRuns,ipaRawRuns,limitIpaText,toggleIpaItalic,remapIpaItalic,portable,parseImport,studyKey,studyStatus,createFlashcards} from '../public/core.js';
import {PersonalWords,sourceQuestions,wordIdentity,FlashcardBookmarks} from '../public/personal.js';
import {zipSync,unzipSync,strToU8,strFromU8} from 'fflate';
const legacy={title:'Words',words:[{english:'achieve',meaning:'達成する',explanation:'A note.'}]};
const memory=()=>{const values=new Map();return {get length(){return values.size;},key:index=>[...values.keys()][index],getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value),removeItem:key=>values.delete(key)};};
test('optional IPA preserves Unicode, accepts pasted delimiters, validates types and length, and keeps legacy JSON compatible',()=>{
  const ipa='əˈtʃiːv',set=structuredClone(legacy);set.words[0].ipa=' [/'+ipa+'/] ';assert.equal(validateSet(set).words[0].ipa,ipa);assert.equal(normalizeIpa('['+ipa+']'),ipa);
  assert.deepEqual(validateSet(legacy),legacy);assert.deepEqual(validateSet({...legacy,words:[{...legacy.words[0],ipa:'[]'}]}),legacy);
  const distinct='ɹ ɻ ʀ ʁ θ ð ɚ ɝ ˈ ˌ ː';assert.equal(validateSet({...legacy,words:[{...legacy.words[0],ipa:distinct}]}).words[0].ipa,distinct);
  for(const value of [null,{},4,[], 'a'.repeat(201),'a\nb','a\tb','a\0b'])assert.throws(()=>validateSet({...legacy,words:[{...legacy.words[0],ipa:value}]}),/invalidIpa/);
  const accented=validateSet({...legacy,title:'Combining marks',words:[{...legacy.words[0],ipa:'ǽ æ̀ æ̂ ǣ æ̆ æ̃ æ̈ é'}]});
  assert.equal(accented.words[0].ipa,'ǽ æ̀ æ̂ ǣ æ̆ æ̃ æ̈ é');
  const saved=validateSet(set),files={'first.json':strToU8(JSON.stringify(portable(saved))),'legacy.json':strToU8(JSON.stringify(portable(legacy))),'accents.json':strToU8(JSON.stringify(portable(accented)))};
  const imported=Object.values(unzipSync(zipSync(files))).flatMap(bytes=>parseImport(JSON.parse(strFromU8(bytes))));assert.deepEqual(imported,[saved,legacy,accented]);
});
test('changing IPA preserves clears, difficult-word streaks, favorites, and resumable flashcards while loading the updated notation',()=>{
  const set={...structuredClone(legacy),id:'words'},edited=structuredClone(set),store=memory(),personal=new PersonalWords(store),originalQuestion=sourceQuestions([set],'en-ja')[0];edited.words[0].ipa='əˈtʃiːv';edited.words[0].ipaItalic=[[0,1]];
  personal.answer(originalQuestion.sources,false);personal.answer(originalQuestion.sources,false);personal.toggleFavorite(wordIdentity(set.id,set.words[0]));
  const progress={[set.id]:{key:studyKey(set),scope:'all-first-pass','en-ja':true,'ja-en':true}};assert.equal(studyStatus(edited,progress),'both');assert.deepEqual(sourceQuestions([edited],'en-ja')[0].sources,originalQuestion.sources);assert.equal(personal.record(originalQuestion.sources[0].key).weak,true);assert.equal(personal.favorite(wordIdentity(edited.id,edited.words[0])),true);
  const bookmarks=new FlashcardBookmarks(store),deck=bookmarks.start('words',createFlashcards(set,'en-ja'),'en-ja','original');deck.flipped=true;bookmarks.save(deck);const resumed=bookmarks.restore('words',createFlashcards(edited,'en-ja'));assert.ok(resumed);assert.equal(resumed.flipped,true);assert.equal(resumed.items[0].ipa,'əˈtʃiːv');assert.deepEqual(resumed.items[0].ipaItalic,[[0,1]]);
});
test('IPA style ranges validate, merge, normalize pasted delimiters and keep whole graphemes together',()=>{
  assert.deepEqual(normalizeIpaData(' [əkwéintəns] ',[[9,10]]),{ipa:'əkwéintəns',ipaItalic:[[7,8]]});
  assert.deepEqual(ipaItalicRanges('abcdef',[[4,6],[2,5],[2,3]]),[[2,6]]);assert.deepEqual(ipaItalicRanges('kǽt',[[2,3]]),[[1,3]]);
  assert.deepEqual(toggleIpaItalic('kǽt',[],2,3),{ipaItalic:[[1,3]],selection:[1,3]});assert.deepEqual(toggleIpaItalic('kǽt',[[1,3]],1,3).ipaItalic,[]);
  assert.deepEqual(toggleIpaItalic('a😀b',[],2,3),{ipaItalic:[[1,3]],selection:[1,3]});
  assert.deepEqual(ipaRuns('əkwéintəns',[[7,8]]),[{text:'əkwéint',italic:false},{text:'ə',italic:true},{text:'ns',italic:false}]);
  for(const ranges of [null,{},'italic',[[0]],[[0,1,2]],[[-1,1]],[[0,20]],[[1,1]],[[0,'1']],Array(201).fill([0,1])])assert.throws(()=>normalizeIpaData('abc',ranges),/invalidIpaStyle/);
  assert.deepEqual(normalizeIpaData(' [ ] ',[[1,4]]),{ipa:''});assert.deepEqual(normalizeIpaData(' / [ kǽt ] / ',[[5,8]]),{ipa:'kǽt',ipaItalic:[[0,3]]});
});
test('IPA italic styles follow insertions, replacement, combining accents and repeated-character deletions',()=>{
  assert.deepEqual(remapIpaItalic('əkwéintəns','Xəkwéintəns',[[7,8]],{start:0,end:0}),[[8,9]]);
  assert.deepEqual(remapIpaItalic('abc','axbc',[[0,3]],{start:1,end:1}),[[0,4]]);
  assert.deepEqual(remapIpaItalic('abc','abcx',[[0,3]],{start:3,end:3}),[[0,3]]);
  assert.deepEqual(remapIpaItalic('abc','aXYZc',[[1,2]],{start:1,end:2}),[[1,4]]);
  assert.deepEqual(remapIpaItalic('abc','aX',[[1,2]],{start:1,end:3}),[]);
  assert.deepEqual(remapIpaItalic('kæt','kǽt',[[1,2]],{start:2,end:2}),[[1,3]]);
  assert.deepEqual(remapIpaItalic('əə','ə',[[1,2]],{start:1,end:1,inputType:'deleteContentBackward'}),[[0,1]]);
  assert.deepEqual(remapIpaItalic('əə','ə',[[1,2]],{start:1,end:1,inputType:'deleteContentForward'}),[]);
  assert.deepEqual(remapIpaItalic('kǽt','',[[1,3]]),[]);
});
test('optional IPA formatting survives JSON and ZIP while legacy sets have no added style field',()=>{
  const input={...structuredClone(legacy),words:[{...legacy.words[0],ipa:'əkwéintəns',ipaItalic:[[7,8]]}]},set=validateSet(input);
  assert.deepEqual(parseImport(JSON.parse(JSON.stringify(portable(set))))[0],set);
  const bytes=zipSync({'set.json':strToU8(JSON.stringify(portable(set)))});assert.deepEqual(parseImport(JSON.parse(strFromU8(unzipSync(bytes)['set.json'])))[0],set);
  assert.deepEqual(validateSet({...legacy,words:[{...legacy.words[0],ipaItalic:[]}]}),legacy);
  assert.throws(()=>validateSet({...legacy,words:[{...legacy.words[0],ipaItalic:[[0,1]]}]}),/invalidIpaStyle/);
  const {ipaItalic,...unstyled}=input.words[0];assert.deepEqual(validateSet({...input,words:[{...input.words[0],ipaItalic:[]}]}).words[0],unstyled);
});
test('explicit typing modes override inherited formatting and preserve whole combining characters',()=>{
  assert.deepEqual(remapIpaItalic('ab','aǽb',[],{start:1,end:1,italic:true}),[[1,3]]);
  assert.deepEqual(remapIpaItalic('abc','axbc',[[0,3]],{start:1,end:1,italic:false}),[[0,1],[2,4]]);
  assert.deepEqual(remapIpaItalic('abc','aXc',[[0,3]],{start:1,end:2,italic:false}),[[0,1],[2,3]]);
  assert.deepEqual(remapIpaItalic('kæt','kǽt',[[1,2]],{start:2,end:2,italic:false}),[[1,3]]);
  assert.deepEqual(ipaRawRuns(' [kǽt] ',[[3,5]]),[{text:' [k',italic:false},{text:'ǽ',italic:true},{text:'t] ',italic:false}]);
  assert.equal(limitIpaText('x'.repeat(199)+'ǽ'),'x'.repeat(199));assert.equal(limitIpaText('a😀b',2),'a');assert.equal(limitIpaText('a😀b',3),'a😀');
});
