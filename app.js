'use strict';
const $=id=>document.getElementById(id);
const state={photos:[],entries:[],processed:0,busy:false};
const recipientKey='reception-ocr-recipient-v1';
$('recipient').value=localStorage.getItem(recipientKey)||'';
$('recipient').addEventListener('input',()=>localStorage.setItem(recipientKey,$('recipient').value));
function status(s){$('status').textContent=s}
function normalize(s){return String(s).replace(/[^0-9]/g,'')}
function valid(s){return /^\d{4}$/.test(s)}
function stats(){let counts=new Map();for(let e of state.entries)counts.set(e.number,(counts.get(e.number)||0)+1);$('photoCount').textContent=state.processed;$('uniqueCount').textContent=counts.size;$('dupCount').textContent=state.entries.length-counts.size;return counts}
function render(){const counts=stats(),unique=[...counts.keys()];$('list').replaceChildren();for(const num of unique){let e=state.entries.find(x=>x.number===num);const row=document.createElement('div');row.className='item';const input=document.createElement('input');input.type='text';input.inputMode='numeric';input.maxLength=4;input.value=num;input.setAttribute('aria-label','受付番号を修正');input.addEventListener('change',()=>{let v=normalize(input.value);if(!valid(v)){alert('4桁の数字を入力してください');input.value=num;return}state.entries.forEach(x=>{if(x.number===num)x.number=v});render()});const info=document.createElement('small');info.textContent=(counts.get(num)>1?'重複 '+counts.get(num)+'件 / ':'')+e.source;const del=document.createElement('button');del.className='danger';del.textContent='削除';del.addEventListener('click',()=>{state.entries=state.entries.filter(x=>x.number!==num);render()});row.append(input,info,del);$('list').append(row)}$('warnings').innerHTML=state.entries.length!==unique.length?'<div class="warning">重複番号はCSVには1回だけ出力します。実際に同じ番号が複数回必要な場合は、この仕様では区別できません。</div>':''}
function showPhotos(){const names=state.photos.map(x=>x.name);$('photos').textContent=names.length?`${names.length}枚選択: ${names.join('、')}`:'画像未選択';if(state.photos.length){const url=URL.createObjectURL(state.photos[0]);$('preview').src=url;$('preview').classList.remove('hidden');$('preview').onload=()=>{URL.revokeObjectURL(url);updateCropPreview()}}else{$('preview').classList.add('hidden');$('preview').removeAttribute('src')}}
function addFiles(files){state.photos.push(...Array.from(files).filter(f=>f.type.startsWith('image/')));showPhotos()}
for(const id of ['camera','gallery'])$(id).addEventListener('change',e=>{addFiles(e.target.files);e.target.value=''});
$('clearPhotos').onclick=()=>{state.photos=[];showPhotos()};
for(const id of ['left','right'])$(id).oninput=()=>{$('leftVal').textContent=$('left').value+'%';$('rightVal').textContent=$('right').value+'%';updateCropPreview()};
function loadImage(file){return new Promise((resolve,reject)=>{const img=new Image();const url=URL.createObjectURL(file);img.onload=()=>{URL.revokeObjectURL(url);resolve(img)};img.onerror=()=>{URL.revokeObjectURL(url);reject(new Error('画像を開けません'))};img.src=url})}
async function cropped(file){const img=await loadImage(file);const left=Number($('left').value)/100,right=Number($('right').value)/100;if(right<=left)throw new Error('切り出し範囲は右端を左端より大きくしてください');const sx=Math.floor(img.naturalWidth*left),sw=Math.max(1,Math.floor(img.naturalWidth*(right-left)));const scale=Math.min(2.5,2400/img.naturalHeight);const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.floor(sw*scale));canvas.height=Math.max(1,Math.floor(img.naturalHeight*scale));const ctx=canvas.getContext('2d',{willReadFrequently:true});ctx.fillStyle='white';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(img,sx,0,sw,img.naturalHeight,0,0,canvas.width,canvas.height);return canvas}
async function updateCropPreview(){
 if(!state.photos.length){const c=$('cropPreview');c.width=1;c.height=1;return}
 try{const croppedCanvas=await cropped(state.photos[0]);const c=$('cropPreview');c.width=croppedCanvas.width;c.height=croppedCanvas.height;c.getContext('2d').drawImage(croppedCanvas,0,0)}catch(e){status('切り出しプレビュー: '+e.message)}
}
function enhance(canvas){
 const out=document.createElement('canvas');const factor=Math.max(1,Math.min(3,Math.floor(1800/canvas.width)));
 out.width=canvas.width*factor;out.height=canvas.height*factor;
 const ctx=out.getContext('2d',{willReadFrequently:true});ctx.imageSmoothingEnabled=true;ctx.drawImage(canvas,0,0,out.width,out.height);
 const data=ctx.getImageData(0,0,out.width,out.height);const pix=data.data;
 for(let i=0;i<pix.length;i+=4){const v=.299*pix[i]+.587*pix[i+1]+.114*pix[i+2];const t=v>165?255:0;pix[i]=pix[i+1]=pix[i+2]=t}
 ctx.putImageData(data,0,0);return out
}
function extract(text){const lines=text.split(/\r?\n/);let out=[];for(const line of lines){const cleaned=line.trim();if(!cleaned)continue; // Reject dates, long IDs, decimal values; accept isolated 4 digit groups only.
const matches=[...cleaned.matchAll(/(?<!\d)\d{4}(?!\d)/g)];for(const m of matches)out.push(m[0]);}return out}
// Detect full-width horizontal separators using pixels near the two edges of the crop.
// These edge strips exclude the centered four-digit numbers.
function findRows(canvas){
 const w=canvas.width,h=canvas.height,ctx=canvas.getContext('2d',{willReadFrequently:true});
 const d=ctx.getImageData(0,0,w,h).data;
 const gray=(x,y)=>{let i=(y*w+x)*4;return .299*d[i]+.587*d[i+1]+.114*d[i+2]};
 const score=[];
 for(let y=0;y<h;y++){
  let sum=0,n=0;
  for(let x=Math.floor(w*.04);x<Math.floor(w*.26);x+=2){sum+=gray(x,y);n++}
  for(let x=Math.floor(w*.74);x<Math.floor(w*.96);x+=2){sum+=gray(x,y);n++}
  score.push(sum/Math.max(1,n));
 }
 const smooth=score.map((v,y)=>{let t=0,n=0;for(let k=-1;k<=1;k++){if(y+k>=0&&y+k<h){t+=score[y+k];n++}}return t/n});
 const baseline=[...smooth].sort((a,b)=>a-b)[Math.floor(h*.65)];
 const threshold=Math.min(baseline-13, [...smooth].sort((a,b)=>a-b)[Math.floor(h*.12)]+12);
 const groups=[];let start=-1;
 for(let y=0;y<=h;y++){
  const dark=y<h&&smooth[y]<threshold;
  if(dark&&start<0)start=y;
  if(!dark&&start>=0){if(y-start<=Math.max(10,h*.012))groups.push(Math.floor((start+y-1)/2));start=-1}
 }
 // Combine adjacent detections from a thick/double line.
 const merged=[];for(const y of groups){if(!merged.length||y-merged[merged.length-1]>Math.max(5,h*.004))merged.push(y);else merged[merged.length-1]=Math.round((merged[merged.length-1]+y)/2)}
 const diffs=merged.slice(1).map((v,i)=>v-merged[i]).filter(v=>v>h*.012);
 const typical=diffs.length?[...diffs].sort((a,b)=>a-b)[Math.floor(diffs.length/2)]:0;
 if(!typical||merged.length<5)return [];
 const rows=[];
 for(let i=0;i<merged.length-1;i++){
  const a=merged[i],b=merged[i+1],gap=b-a;
  if(gap<typical*.62||gap>typical*1.55)continue;
  rows.push([Math.max(0,a+Math.max(2,Math.floor(gap*.10))),Math.min(h,b-Math.max(2,Math.floor(gap*.10)))]);
 }
 return rows;
}
function rowImage(canvas,range){
 const [a,b]=range,w=canvas.width,h=b-a;
 const out=document.createElement('canvas');
 // Tight crop to the center of the original column, then enlarge with interpolation.
 const sx=Math.floor(w*.12),sw=Math.floor(w*.76),factor=Math.max(3,Math.min(6,Math.floor(450/sw)));
 out.width=sw*factor;out.height=Math.max(1,h*factor);
 const ctx=out.getContext('2d');ctx.fillStyle='white';ctx.fillRect(0,0,out.width,out.height);
 ctx.imageSmoothingEnabled=true;ctx.imageSmoothingQuality='high';ctx.drawImage(canvas,sx,a,sw,h,0,0,out.width,out.height);
 return out;
}
async function recognizeRows(worker,canvas,file){
 const rows=findRows(canvas);
 $('ocrDebug').value+=`\n[${file} / 横線検出] ${rows.length}行\n`;
 if(rows.length<3)return {found:[],rows:0};
 await worker.setParameters({tessedit_pageseg_mode:'7',tessedit_char_whitelist:'0123456789',user_defined_dpi:'300'});
 const found=[];let failed=0;
 for(let i=0;i<rows.length;i++){
  const im=rowImage(canvas,rows[i]);
  const result=await worker.recognize(im);
  const raw=result.data.text.trim();
  const digits=raw.replace(/\s/g,'');
  if(/^\d{4}$/.test(digits))found.push(digits);
  else {failed++;$('ocrDebug').value+=`行${i+1}: ${JSON.stringify(raw)} (未確定)\n`}
  $('progress').value=Math.round((i+1)/rows.length*100);
 }
 $('ocrDebug').value+=`認識成功 ${found.length} / ${rows.length}行、未確定 ${failed}行\n`;
 return {found,rows:rows.length,failed};
}
$('scan').onclick=async()=>{
 if(state.busy)return;
 if(!state.photos.length){alert('先に写真を選択してください');return}
 if(!window.Tesseract){alert('OCRライブラリを読み込めません。通信状態を確認してください');return}
 state.busy=true;$('scan').disabled=true;$('progress').classList.remove('hidden');
 let worker;const pending=state.photos.splice(0);showPhotos();
 try{
  status('OCRエンジンを準備しています…');
  worker=await Tesseract.createWorker('eng',1,{logger:m=>{if(m.status==='recognizing text')$('progress').value=Math.round(m.progress*100)}});
  for(let i=0;i<pending.length;i++){
   const file=pending[i];status(`${i+1}/${pending.length}枚目: ${file.name}`);
   try{
    const canvas=await cropped(file);
    let result=await recognizeRows(worker,canvas,file.name);
    let found=result.found;
    if(result.rows<3){
     $('ocrDebug').value+=`横線検出が不十分なため通常OCRを試行\n`;
     await worker.setParameters({tessedit_pageseg_mode:'6',tessedit_char_whitelist:'0123456789'});
     const whole=await worker.recognize(canvas);found=extract(whole.data.text);
     $('ocrDebug').value+=`[通常OCR]\n${whole.data.text}\n`;
    }
    for(const number of found)state.entries.push({number,source:file.name});
    state.processed++;render();
    const warning=result.rows>=3?`（${result.rows}行検出。未確定 ${result.failed}行）`:'';
    status(`${i+1}/${pending.length}枚処理。${found.length}件抽出 ${warning}`);
    if(!found.length||result.failed>0)alert(`${file.name}: ${found.length}件認識 ${warning}。読み落としや誤認識の可能性があります。写真と照合してください。`);
   }catch(err){state.photos.push(file);status(`${file.name}: ${err.message}`)}
  }
 }catch(err){state.photos.push(...pending.filter(f=>!state.photos.includes(f)));status('OCR初期化に失敗: '+err.message)}
 finally{if(worker)await worker.terminate();state.busy=false;$('scan').disabled=false;$('progress').classList.add('hidden');showPhotos();render()}
};
$('add').onclick=()=>{const n=normalize($('newNumber').value);if(!valid(n)){alert('受付番号は4桁の数字で入力してください');return}state.entries.push({number:n,source:'手動追加'});$('newNumber').value='';render()};
$('reset').onclick=()=>{if(confirm('認識した番号をすべて削除しますか？')){state.entries=[];state.processed=0;render()}};
function csv(){let numbers=[...new Set(state.entries.map(e=>e.number))];if($('sort').checked)numbers.sort((a,b)=>Number(a)-Number(b));return '\uFEFF受付No.\r\n'+numbers.map(n=>'"'+n+'"').join('\r\n')+'\r\n'}
// Standard CSV quoted text; Excel may still infer numbers on direct open. Import column as text.
function file(){return new File([csv()],'reception_numbers_'+new Date().toISOString().slice(0,10)+'.csv',{type:'text/csv;charset=utf-8'})}
$('download').onclick=()=>{if(!state.entries.length){alert('番号がありません');return}const f=file(),url=URL.createObjectURL(f),a=document.createElement('a');a.href=url;a.download=f.name;a.click();setTimeout(()=>URL.revokeObjectURL(url),10000)};
$('mail').onclick=async()=>{if(!state.entries.length){alert('番号がありません');return}const f=file();const recipient=$('recipient').value.trim();if(!recipient){alert('送信先メールアドレスを入力してください');return}if(!$('recipient').checkValidity()){alert('正しいメールアドレスを入力してください');return}try{if(navigator.canShare?.({files:[f]})){await navigator.share({files:[f],title:'受付番号CSV',text:'送信先: '+recipient+'\n共有先でメールを選択し、宛先を確認してください。'});return}}catch(e){if(e.name==='AbortError')return;alert('共有に失敗: '+e.message)}alert('このブラウザではファイル添付共有が使えません。CSVを保存し、メールアプリから添付してください。');$('download').click()};
render();if('serviceWorker'in navigator)window.addEventListener('load',()=>navigator.serviceWorker.register('./sw.js').catch(()=>{}));
