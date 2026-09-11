'use strict';
// 局域网HTTP页面没有randomUUID，控件标识不涉及鉴权，使用随机字节兼容。
if(!crypto.randomUUID)crypto.randomUUID=()=>Array.from(crypto.getRandomValues(new Uint8Array(16)),b=>b.toString(16).padStart(2,'0')).join('');
// 老浏览器（如 Safari 16 以下）没有 AbortSignal.timeout，补一个等价实现
if(!AbortSignal.timeout)AbortSignal.timeout=ms=>{const c=new AbortController();setTimeout(()=>c.abort(new DOMException('请求超时','TimeoutError')),ms);return c.signal;};
// 可选图标（不含工具栏图标）与主题配色，与参考站一致的具名色板。
// 必须声明在配置初始化之前，validate() 首次加载时就会用到。
const ICON_KEYS=['thermometer','droplet','water','wind','bolt','bulb','fan','chip','server','battery','cloud','sun','snow','gauge','power','plug','signal','bell','lock','unlock','video','camera','activity'];
const COLORS=[['#3b82f6','蓝色 (Blue)'],['#f97316','橙色 (Orange)'],['#ef4444','红色 (Red)'],['#22c55e','绿色 (Green)'],['#64748b','灰色 (Slate)'],['#06b6d4','青色 (Cyan)'],['#eab308','黄色 (Yellow)'],['#14b8a6','蓝绿 (Teal)'],['#a855f7','紫色 (Purple)'],['#ec4899','粉色 (Pink)']];
const LEGACY_COLOR='#13a898';
// 猜不到语义时使用的中性图标池（避免把水滴/温度计之类乱配到无关控件上）
const NEUTRAL_ICONS=['activity','gauge','signal','server','chip','bolt','fan','battery','cloud','sun'];
// 旧配置没有图标字段，按名称/标识符猜一个合适的图标。
const ICON_HINTS=[['温度','thermometer'],['temp','thermometer'],['湿度','droplet'],['humidity','droplet'],['hum','droplet'],['电压','power'],['voltage','power'],['volt','power'],['分压','gauge'],['压力','gauge'],['press','gauge'],['电阻','bolt'],['resistance','bolt'],['电流','activity'],['current','activity'],['水位','water'],['water','water'],['烟雾','wind'],['烟','wind'],['风速','wind'],['风扇','fan'],['浓度','cloud'],['co2','cloud'],['光照','sun'],['lux','sun'],['光','sun'],['电池','battery'],['电量','battery'],['门','lock'],['lock','lock'],['视频','camera'],['图像','camera'],['报警','bell'],['蜂鸣','bell']];
function guessIcon(w){const s=(w.name+' '+w.key).toLowerCase();for(const [k,ic] of ICON_HINTS){if(s.indexOf(k.toLowerCase())>=0)return ic;}return '';}
// 新增控件时默认取「还没被用过」的颜色与图标，避免所有卡片长得一样。
function nextUnused(kind){const used=new Set(widgets.map(w=>w[kind]));const pool=kind==='icon'?ICON_KEYS:COLORS.map(c=>c[0]);for(const c of pool)if(!used.has(c))return c;return pool[widgets.length%pool.length];}
// 演示数据按标识符生成，与控件顺序无关（早期按下标配值，移动控件后会错配）。
const DEMO_SERIES={'MEMS_R':[1200000000,100000000,10000],'MEMS_V':[1.6,.03,4000],'working_v':[1.571,.01,30000],'temperature':[26.4,.9,40000],'humidity':[45.2,2.4,33000]};
function hashKey(s){let h=2166136261;for(let i=0;i<s.length;i++){h^=s.charCodeAt(i);h=Math.imul(h,16777619);}return h>>>0;}
function demoValue(key,t){const s=DEMO_SERIES[key];if(s)return s[0]+Math.sin(t/s[2])*s[1];const h=hashKey(key),base=(h%9000)/10+10;return base+Math.sin(t/(4000+h%6000))*base*.08;}
const $=s=>document.querySelector(s);
const defaults=[['MEMS电阻','MEMS_R','Ω',0,'bolt','#f97316'],['MEMS分压','MEMS_V','V',2,'gauge','#3b82f6'],['工作电压','working_v','V',2,'power','#06b6d4'],['温度','temperature','°C',1,'thermometer','#ef4444'],['湿度','humidity','%RH',1,'droplet','#14b8a6']].map(([name,key,unit,decimals,icon,color])=>({id:crypto.randomUUID(),name,key,unit,decimals,icon,color,type:'card',min:'',max:''}));
let widgets=defaults.slice();try{const v=JSON.parse(localStorage.getItem('labscope.widgets'));if(v)widgets=validate(v);}catch(e){setNotice('warn','本地配置读取失败，已改用默认控件：'+(e&&e.message?e.message:e));}
// 历史遗留：早期版本会自动追加一个与某控件同标识符的「XX趋势」控件，现在每个控件都有曲线，属重复项，清理一次。
const dupIdx=widgets.findIndex(w=>w.type==='chart'&&/趋势$/.test(w.name)&&widgets.some(o=>o!==w&&o.key===w.key));
if(dupIdx>=0){const gone=widgets[dupIdx].name;widgets.splice(dupIdx,1);persist();setNotice('info','已移除与其它控件重复的自动生成控件「'+gone+'」');}
// 旧配置：没有图标、或全部都是通用兜底图标 activity、或所有控件共用同一个青绿色 —— 逐个补齐。
// 只动这两个字段，用户明确选过的颜色/图标不覆盖。
const sameIcon=widgets.length>1&&widgets.every(w=>w.icon===widgets[0].icon);
let migrated=false,ni=0;
widgets.forEach((w,i)=>{
 const g=guessIcon(w);
 if(!w.icon){w.icon=g||NEUTRAL_ICONS[ni++%NEUTRAL_ICONS.length];migrated=true;}
 else if(g&&w.icon==='activity'){w.icon=g;migrated=true;}
 else if(sameIcon&&!g){w.icon=NEUTRAL_ICONS[ni++%NEUTRAL_ICONS.length];migrated=true;}
 if(w.color===LEGACY_COLOR){w.color=COLORS[i%COLORS.length][0];migrated=true;}
});
if(migrated){persist();if(!$('#notice').textContent)setNotice('info','已为旧配置的控件补齐图标与配色，可在「编辑控件」中逐个调整。');}
let credentials=null, demo=false,busy=false,timer=null,editing=null,dragged=null;
// 自建服务端走 /api/properties 代理；静态托管或 file:// 直开时由浏览器直连 OneNET。
let useProxy=location.protocol!=='file:';
let latest={},records=[],seen=new Map(),lastResponse=0,selectedId=null,pauseAt=null,deviceState='unknown',connError='',pollTick=0;
function validate(v){if(!Array.isArray(v)||v.length>40)throw Error('配置最多包含40个控件');return v.map(w=>{if(!w||typeof w.name!=='string'||typeof w.key!=='string'||!/^\w{1,100}$/.test(w.key)||!Number.isInteger(Number(w.decimals))||w.decimals<0||w.decimals>6)throw Error('控件配置格式错误');const min=w.min===undefined||w.min===null?'':String(w.min).trim(),max=w.max===undefined||w.max===null?'':String(w.max).trim();if(min!==''&&!Number.isFinite(Number(min))||max!==''&&!Number.isFinite(Number(max)))throw Error('阈值范围错误');if(min!==''&&max!==''&&Number(min)>=Number(max))throw Error('上限阈值必须大于下限');return {...w,id:crypto.randomUUID(),type:['card','chart'].includes(w.type)?w.type:'card',auto:w.auto===true,name:w.name.slice(0,60),unit:String(w.unit||'').slice(0,20),min,max,icon:ICON_KEYS.includes(w.icon)?w.icon:'',color:/^#[0-9a-f]{6}$/i.test(w.color)?w.color:'#3b82f6'};});}
let persistWarned=false;
// 本浏览器存储可能被禁用或写满（隐私模式/配额），失败时不能中断后续操作
function persist(){try{localStorage.setItem('labscope.widgets',JSON.stringify(widgets));}catch(e){if(!persistWarned){persistWarned=true;setNotice('warn','无法保存到本浏览器（存储被禁用或已满）：本次改动只在当前页面生效。');}}}
// 连接信息（含 Token）可选保存在本浏览器，便于下次打开自动连接；导出配置里始终不含它。
const CRED_KEY='labscope.credentials';
function loadCredentials(){try{const v=JSON.parse(localStorage.getItem(CRED_KEY));return v&&v.productId&&v.deviceName&&v.token?v:null;}catch(e){return null;}}
function saveCredentials(c){try{if(c&&c.productId&&c.deviceName&&c.token)localStorage.setItem(CRED_KEY,JSON.stringify({productId:c.productId,deviceName:c.deviceName,token:c.token}));else localStorage.removeItem(CRED_KEY);}catch(e){}}
function el(tag,text,cls){const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(cls)n.className=cls;return n;}
// 内联 SVG 图标（零依赖，离线/file:// 均可用）。
const ICONS={activity:'<path d="M3 12h4l3 8 4-16 3 8h4"/>',chip:'<rect x="7" y="7" width="10" height="10" rx="2"/><path d="M10 3v4M14 3v4M10 17v4M14 17v4M3 10h4M3 14h4M17 10h4M17 14h4"/>',thermometer:'<path d="M12 3a2 2 0 0 0-2 2v8.3a4 4 0 1 0 4 0V5a2 2 0 0 0-2-2z"/>',droplet:'<path d="M12 3s6 6.5 6 10a6 6 0 0 1-12 0c0-3.5 6-10 6-10z"/>',wind:'<path d="M3 8h10a3 3 0 1 0-3-3"/><path d="M3 16h13a3 3 0 1 1-3 3"/><path d="M3 12h18"/>',water:'<path d="M3 12c2-2 4-2 6 0s4 2 6 0 4-2 6 0"/><path d="M3 17c2-2 4-2 6 0s4 2 6 0 4-2 6 0"/>',bolt:'<path d="M13 2L4 14h6l-1 8 9-12h-6z"/>',bulb:'<path d="M9 18h6M10 21h4"/><path d="M12 3a6 6 0 0 0-3.5 10.9c.6.5.9 1.3.9 2.1h5.2c0-.8.3-1.6.9-2.1A6 6 0 0 0 12 3z"/>',fan:'<circle cx="12" cy="12" r="2"/><path d="M12 10V5a2 2 0 1 1 3 3"/><path d="M14 12h5a2 2 0 1 1-3 3"/><path d="M12 14v5a2 2 0 1 1-3-3"/><path d="M10 12H5a2 2 0 1 1 3-3"/>',server:'<rect x="3" y="4" width="18" height="7" rx="2"/><rect x="3" y="13" width="18" height="7" rx="2"/><path d="M7 7.5h.01M7 16.5h.01"/>',battery:'<rect x="2" y="7" width="17" height="10" rx="2"/><path d="M22 10v4M6 11v2M10 11v2"/>',cloud:'<path d="M7 18h9a4 4 0 0 0 0-8 6 6 0 0 0-11.5 2A3.5 3.5 0 0 0 7 18z"/>',sun:'<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.5 1.5M17.5 17.5L19 19M19 5l-1.5 1.5M6.5 17.5L5 19"/>',snow:'<path d="M12 2v20M4 7l16 10M20 7L4 17"/>',lock:'<rect x="4" y="10" width="16" height="10" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>',unlock:'<rect x="4" y="10" width="16" height="10" rx="2"/><path d="M8 10V7a4 4 0 0 1 7-2"/>',video:'<rect x="2" y="6" width="13" height="12" rx="2"/><path d="M15 11l7-4v10l-7-4z"/>',camera:'<path d="M3 8h3l2-3h8l2 3h3v11H3z"/><circle cx="12" cy="13" r="3.5"/>',bell:'<path d="M6 16V11a6 6 0 1 1 12 0v5l2 3H4z"/><path d="M10 21h4"/>',plug:'<path d="M9 3v6M15 3v6"/><path d="M6 9h12v3a6 6 0 0 1-12 0z"/><path d="M12 18v3"/>',power:'<path d="M12 4v8"/><path d="M6.5 7a8 8 0 1 0 11 0"/>',gauge:'<circle cx="12" cy="14" r="8"/><path d="M12 14l4-4"/>',signal:'<path d="M5 12a7 7 0 0 1 14 0"/><path d="M8 15a4 4 0 0 1 8 0"/><circle cx="12" cy="18" r="1"/>',up:'<path d="M12 19V5M5 12l7-7 7 7"/>',down:'<path d="M12 5v14M5 12l7 7 7-7"/>',edit:'<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>',trash:'<path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14"/>',pause:'<path d="M9 5v14M15 5v14" stroke-width="3"/>',play:'<path d="M7 4l12 8-12 8z" fill="currentColor" stroke="none"/>'};
function icon(name){const s=document.createElementNS('http://www.w3.org/2000/svg','svg');s.setAttribute('viewBox','0 0 24 24');s.setAttribute('fill','none');s.setAttribute('stroke','currentColor');s.setAttribute('stroke-width','2');s.setAttribute('stroke-linecap','round');s.setAttribute('stroke-linejoin','round');s.setAttribute('aria-hidden','true');s.innerHTML=ICONS[name]||'';return s;}
function setNotice(kind,text){const n=$('#notice');n.dataset.kind=kind||'';n.textContent=text||'';n.classList.remove('pop');if(text){void n.offsetWidth;n.classList.add('pop');}}
// 大数字千分位；超长时曲线轴退回紧凑单位，避免标签被裁。
function fmt(v,d){return Number(v).toLocaleString('zh-CN',{minimumFractionDigits:d,maximumFractionDigits:d});}
function fmtRange(w){const a=w.min!==''?fmt(Number(w.min),w.decimals):null,b=w.max!==''?fmt(Number(w.max),w.decimals):null;return [a,b].filter(x=>x!==null).join(' ~ ')+(w.unit||'');}
// 页面不可见期间浏览器会节流定时器，这段本来就没有采样，不应画成“断线”。
let hideSpans=[],hiddenSince=null;
function markHidden(){hiddenSince=Date.now();}
function markVisible(){if(hiddenSince!==null){hideSpans.push({from:hiddenSince,to:Date.now()});if(hideSpans.length>60)hideSpans.shift();hiddenSince=null;}}
function inHideSpan(a,b){const gap=b-a;let cover=0;if(hiddenSince!==null)cover=Math.max(cover,Math.max(0,b-Math.max(a,hiddenSince)));for(const s of hideSpans)cover=Math.max(cover,Math.max(0,Math.min(b,s.to)-Math.max(a,s.from)));return cover>=gap*0.7;}
// 断线阈值跟着采样节奏走：浏览器 1 秒轮询→2.5 秒；服务端 5 秒采集→10 秒。
// 必须取「服务端采集间隔」作为下限，否则页面里 1 秒的实时点会把服务端 5 秒的历史点误判成断线。
function gapLimit(pts){let med=0;if(pts&&pts.length>=3){const d=[];for(let i=1;i<pts.length;i++){const g=pts[i].time-pts[i-1].time;if(g>0)d.push(g);}if(d.length>=2){d.sort((a,b)=>a-b);med=d[Math.floor(d.length/2)];}}const floor=serverPollMs?serverPollMs*2:0;return Math.max(2500,Math.min(120000,Math.max(med*2.5,floor,2500)));}
// 按阈值切段；间隔若落在“未采样”区间内则不断开，改为虚线连接。
function buildSegments(pts){const lim=gapLimit(pts),segs=[];let seg=[],voidHead=false;for(const p of pts){if(seg.length&&p.time-seg[seg.length-1].time>lim){segs.push({pts:seg,voidHead});voidHead=inHideSpan(seg[seg.length-1].time,p.time);seg=[];}seg.push(p);}if(seg.length)segs.push({pts:seg,voidHead});return segs;}
function time(t){return new Date(t).toLocaleTimeString('zh-CN',{hour12:false});}
function stamp(t){if(t===null||t===undefined||t==='')return NaN;if(typeof t==='number'||/^\d+$/.test(t)){const n=Number(t);return n<1e12?n*1000:n;}return Date.parse(t);}
// 纵轴标签：默认千分位；过长（>14 字符）才退回 万/亿，避免被左侧留白区裁掉。
function axisDecimals(low,high){const step=Math.abs(high-low)/4;return step>=1?0:step>=0.05?1:2;}
function axisLabel(v,dec){return Number(v).toLocaleString('zh-CN',{minimumFractionDigits:dec,maximumFractionDigits:dec});}
function renderTabs(){const box=$('#chartTabs');box.replaceChildren();widgets.forEach(w=>{const b=el('button',w.name,'tab'+(w.id===selectedId?' active':''));b.type='button';b.onclick=()=>{if(selectedId===w.id){drawTrend();return;}selectedId=w.id;render();};box.append(b);});}
function setPauseLabel(){const b=$('#trendPause');b.replaceChildren(icon(pauseAt?'play':'pause'),document.createTextNode(pauseAt?'恢复滚动':'暂停滚动'));}
function syncAxisInputs(){const w=widgets.find(x=>x.id===selectedId);const a=$('#axisMin'),b=$('#axisMax');if(!a||!b)return;a.value=w&&w.min!==''?w.min:'';b.value=w&&w.max!==''?w.max:'';const btn=$('#axisAuto');if(btn)btn.classList.toggle('active',!!(w&&w.auto===true));}
function applyAxis(){const w=widgets.find(x=>x.id===selectedId);if(!w)return;const a=$('#axisMin'),b=$('#axisMax'),min=a.value.trim(),max=b.value.trim();
 if((min!==''&&!Number.isFinite(Number(min)))||(max!==''&&!Number.isFinite(Number(max)))){setNotice('warn','纵轴范围必须是数字或留空');syncAxisInputs();return;}
 if(min!==''&&max!==''&&Number(min)>=Number(max)){setNotice('warn','纵轴上限必须大于下限');syncAxisInputs();return;}
 w.min=min;w.max=max;w.auto=(min===''&&max==='');persist();syncAxisInputs();update();
 setNotice('info','已同步「'+w.name+'」的纵轴范围到趋势图与卡片迷你曲线：'+(min!==''?fmt(Number(min),w.decimals):'自动')+' ~ '+(max!==''?fmt(Number(max),w.decimals):'自动')+(min===''&&max===''?'（两项都留空，已切回自动）':'（手动填写会自动关闭「自动」开关）'));}
function drawTrend(){const w=widgets.find(x=>x.id===selectedId)||widgets[0];if(w)drawSeries($('#trendCanvas'),w,false);}
function render(){const grid=$('#grid');grid.replaceChildren();if(!widgets.some(w=>w.id===selectedId))selectedId=widgets.length?widgets[0].id:null;widgets.forEach((w,i)=>{const card=el('article',undefined,'widget'+(w.id===selectedId?' selected':''));card.dataset.id=w.id;
 const main=el('div',undefined,'widget-main'),name=el('div',undefined,'wname');name.append(document.createTextNode(w.name),el('span',w.key,'key'));
 const foot=el('div',undefined,'widget-foot');foot.append(el('span','等待数据','stamp'),el('span','','meta'));
 main.append(name,el('div','—','value'),foot);
 const tools=el('div',undefined,'tools');
 for(const [n,label,action,danger]of [['up','上移',()=>move(i,-1)],['down','下移',()=>move(i,1)],['edit','编辑',()=>edit(w)],['trash','删除',()=>{if(confirm('删除此控件？平台属性和本次数据仍保留。')){widgets.splice(i,1);persist();render();}},true]]){const b=el('button');b.append(icon(n));b.title=label;b.setAttribute('aria-label',label);if(danger)b.classList.add('danger');b.onclick=action;tools.append(b);}
 const chip=el('div',undefined,'widget-icon');chip.style.color=w.color;chip.style.background=w.color+'1f';chip.append(icon(w.icon||'activity'));
 card.append(main,el('canvas','','spark'),tools,chip);
 card.onclick=e=>{if(e.target.closest('button'))return;if(selectedId!==w.id){selectedId=w.id;render();}const t=$('.trend');if(t){t.classList.remove('flash');void t.offsetWidth;t.classList.add('flash');t.scrollIntoView({behavior:'smooth',block:'center'});}};
 card.draggable=true;card.ondragstart=()=>dragged=w.id;card.ondragend=()=>{dragged=null;};card.ondragover=e=>e.preventDefault();card.ondrop=e=>{e.preventDefault();const from=widgets.findIndex(x=>x.id===dragged);if(from>=0){widgets.splice(i,0,widgets.splice(from,1)[0]);persist();render();}};
 grid.append(card);});renderTabs();setPauseLabel();syncAxisInputs();update();}
function move(i,d){const j=i+d;if(j<0||j>=widgets.length)return;const w=widgets[i];[widgets[i],widgets[j]]=[widgets[j],widgets[i]];persist();render();const card=[...$('#grid').children].find(x=>x.dataset.id===w.id);if(card){card.classList.add('moved');card.scrollIntoView({behavior:'smooth',block:'nearest'});setTimeout(()=>card.classList.remove('moved'),900);}}
function update(){widgets.forEach(w=>{const card=[...$('#grid').children].find(x=>x.dataset.id===w.id);if(!card)return;const p=latest[w.key],v=p?Number(p.value):NaN;
 const value=card.querySelector('.value'),raw=p?String(v):'';
 if(raw&&value.dataset.raw&&value.dataset.raw!==raw){value.classList.remove('flash');void value.offsetWidth;value.classList.add('flash');}
 value.dataset.raw=raw;value.replaceChildren(document.createTextNode(p?fmt(v,w.decimals):'—'),el('small',w.unit));
 value.title=(w.key==='MEMS_R'&&p&&v>=2000000000)?'已达到上传上限，非精确电阻值':'';
 const stale=!!p&&Number.isFinite(p.time)&&Date.now()-p.time>10000,hasRange=w.min!==''||w.max!=='',over=!!p&&hasRange&&((w.min!==''&&v<Number(w.min))||(w.max!==''&&v>Number(w.max)));
 const st=card.querySelector('.stamp');st.dataset.kind=!p?'idle':over?'alert':stale?'stale':'ok';st.textContent=(!p?'等待数据':over?'超限':stale?'数据陈旧':'正常')+(hasRange?' ('+fmtRange(w)+')':'');st.title=hasRange?'设定范围 '+fmtRange(w):'';
 card.querySelector('.meta').textContent=p?(Number.isFinite(p.time)?time(p.time):'平台未提供时间'):'尚无时间戳';
 const spark=card.querySelector('canvas.spark');if(spark){try{drawSeries(spark,w,true);}catch(err){console.warn('迷你曲线绘制失败',err);}}
 });try{drawTrend();}catch(err){console.warn('趋势图绘制失败',err);}$('#count').textContent=`本次记录 ${records.length} 条属性数据`;}
// 曲线时间窗口（默认 5 分钟），选择会保存在本浏览器
const WIN_KEY='labscope.window',WIN_OPTIONS=[60000,300000,900000,1800000,3600000];
let windowMs=(function(){try{const v=Number(localStorage.getItem(WIN_KEY));return WIN_OPTIONS.indexOf(v)>=0?v:300000;}catch(e){return 300000;}})();
function windowLabel(){return windowMs>=3600000?(windowMs/3600000)+' 小时':(windowMs/60000)+' 分钟';}
function renderWindowLabels(){const t=$('#trendTitle');if(t)t.textContent='最近 '+windowLabel()+'变化趋势';const s=$('#windowSelect');if(s)s.value=String(windowMs);}
function setWindow(ms){if(WIN_OPTIONS.indexOf(ms)<0)return;windowMs=ms;try{localStorage.setItem(WIN_KEY,String(ms));}catch(e){}renderWindowLabels();if(serverMode)fetchServerHistory(Math.max(5,Math.round(ms/60000)));update();}
function drawSeries(canvas,w,compact){if(!canvas)return;const box=canvas.getBoundingClientRect();if(box.width<1)return;const dpr=devicePixelRatio||1,h=compact?62:280;canvas.width=Math.max(1,Math.round(box.width*dpr));canvas.height=Math.round(h*dpr);const ctx=canvas.getContext('2d');ctx.scale(dpr,dpr);const width=box.width,right=compact?4:16,top=compact?9:16,bottom=compact?9:32,anchor=pauseAt||Date.now();let left=compact?4:100,end=anchor,start=end-windowMs,pts=records.filter(p=>p.key===w.key&&p.time>=start&&p.time<=end);
// 设备时钟快于浏览器时，点会全部落在窗口右侧之外（窗口内一个点都没有）→ 以该属性最新的点为窗口右端重新取
if(!pts.length){let newest=0;for(const p of records)if(p.key===w.key&&p.time>newest)newest=p.time;if(newest>end){end=newest;start=end-windowMs;pts=records.filter(p=>p.key===w.key&&p.time>=start&&p.time<=end);}}
let dLow=Infinity,dHigh=-Infinity;for(const p of pts){if(p.value<dLow)dLow=p.value;if(p.value>dHigh)dHigh=p.value;}
// 纵轴范围：开了「自动」或根本没设上下限 → 按数据自适应；否则按填写的上下限（超出部分贴在边缘）
let low,high;if(w.auto===true||(w.min===''&&w.max==='')){low=dLow;high=dHigh;}else{low=w.min!==''?Number(w.min):dLow;high=w.max!==''?Number(w.max):dHigh;}
if(!Number.isFinite(low))low=0;if(!Number.isFinite(high))high=1;
if(high<low){const t=low;low=high;high=t;}
if(low===high){low-=Math.abs(low)*.05||1;high+=Math.abs(high)*.05||1;}
// 纵轴标签宽度自适应：千分位后的长数字（如 1,306,747,326）需要更宽的左侧留白；窄屏用更小字号换回绘图区
const dec=compact?0:axisDecimals(low,high),axisFont=(width<420?'10px':'11px')+' -apple-system,"Segoe UI","Microsoft YaHei",sans-serif';
if(!compact){ctx.font=axisFont;let lw=0;for(let i=0;i<5;i++)lw=Math.max(lw,ctx.measureText(axisLabel(high-(high-low)*i/4,dec)).width);left=Math.min(Math.max(left,lw+14),Math.max(48,width*0.42));}
const plotW=width-left-right,plotH=h-top-bottom,X=t=>left+(t-start)/windowMs*plotW,Y=v=>{const c=v<low?low:(v>high?high:v);return top+(high-c)/(high-low)*plotH;};
 if(!compact){ctx.font=axisFont;ctx.lineWidth=1;ctx.fillStyle='#9ca3af';for(let i=0;i<5;i++){const y=top+plotH*i/4;ctx.strokeStyle='#eef2f7';ctx.beginPath();ctx.moveTo(left,y);ctx.lineTo(width-right,y);ctx.stroke();ctx.textAlign='right';ctx.fillText(axisLabel(high-(high-low)*i/4,dec),left-9,y+4);}
  // 横轴：按可用宽度决定刻度数量与格式（窄屏或长窗口去掉秒），首尾标签贴边对齐避免被裁
  const short=windowMs>=3600000||plotW<520,fmt=t=>{const s=time(t);return short?s.slice(0,5):s;},slot=ctx.measureText(fmt(start)).width+18,ticks=Math.max(2,Math.min(5,Math.floor(plotW/slot)));
  for(let i=0;i<=ticks;i++){ctx.textAlign=i===0?'left':(i===ticks?'right':'center');ctx.fillText(fmt(start+(end-start)*i/ticks),left+plotW*i/ticks,h-9);}
  ctx.textAlign='left';}
 const segs=buildSegments(pts);
ctx.save();ctx.beginPath();ctx.rect(left,top,plotW,plotH);ctx.clip();
for(let i=0;i<segs.length;i++){const s=segs[i].pts,prev=i>0?segs[i-1].pts[segs[i-1].pts.length-1]:null;if(segs[i].voidHead&&prev){ctx.save();ctx.setLineDash([4,4]);ctx.globalAlpha=.45;ctx.beginPath();ctx.moveTo(X(prev.time),Y(prev.value));ctx.lineTo(X(s[0].time),Y(s[0].value));ctx.strokeStyle=w.color;ctx.lineWidth=2;ctx.stroke();ctx.restore();}if(s.length>1){const g=ctx.createLinearGradient(0,top,0,top+plotH);g.addColorStop(0,w.color+'40');g.addColorStop(1,w.color+'00');ctx.beginPath();ctx.moveTo(X(s[0].time),Y(s[0].value));for(const p of s)ctx.lineTo(X(p.time),Y(p.value));ctx.lineTo(X(s[s.length-1].time),top+plotH);ctx.lineTo(X(s[0].time),top+plotH);ctx.closePath();ctx.fillStyle=g;ctx.fill();}ctx.beginPath();ctx.moveTo(X(s[0].time),Y(s[0].value));for(const p of s)ctx.lineTo(X(p.time),Y(p.value));ctx.strokeStyle=w.color;ctx.lineWidth=2;ctx.lineJoin='round';ctx.lineCap='round';ctx.stroke();}
if(pts.length){const last=pts[pts.length-1],lx=X(last.time),ly=Y(last.value);ctx.beginPath();ctx.arc(lx,ly,7,0,Math.PI*2);ctx.fillStyle=w.color+'22';ctx.fill();ctx.beginPath();ctx.arc(lx,ly,3.5,0,Math.PI*2);ctx.fillStyle=w.color;ctx.fill();ctx.strokeStyle='#fff';ctx.lineWidth=1.5;ctx.stroke();}
ctx.restore();
if(!pts.length){ctx.fillStyle='#9ca3af';ctx.font=(compact?11:12)+'px -apple-system,"Segoe UI","Microsoft YaHei",sans-serif';ctx.textAlign='left';ctx.fillText('等待新时间戳数据',compact?left+6:left+16,compact?h/2+4:top+plotH/2);}}
function ingest(data){const now=Date.now();for(const item of data){const key=item&&typeof item.identifier==='string'?item.identifier.trim():'';if(!key)continue;const value=Number(item.value);if(item.value===''||item.value===null||!Number.isFinite(value))continue;const t=stamp(item.time);latest[key]={value,time:t};if(!Number.isFinite(t))continue;const prior=seen.get(key);if(prior!==undefined&&t<=prior)continue;seen.set(key,t);records.push({key,time:t,received:now,value});}if(records.length>100000){records.splice(0,records.length-100000);setNotice('warn','记录达到100000条，已移除最早记录，请及时导出。');}update();}
// 取数适配层：自建服务端走 /api/properties，静态托管（GitHub Pages）或 file:// 直连 OneNET。
function parseResult(result,ok){if(!ok||result.code!==0)throw Error(result.msg||`接口错误 ${result.code}`);if(!Array.isArray(result.data))throw Error('平台返回的数据格式不正确');return result.data;}
async function queryDirect(){const url=new URL('https://iot-api.heclouds.com/thingmodel/query-device-property');url.searchParams.set('product_id',credentials.productId);url.searchParams.set('device_name',credentials.deviceName);const r=await fetch(url,{headers:{Authorization:credentials.token},signal:AbortSignal.timeout(10000)});return parseResult(await r.json(),r.ok);}
async function queryProperties(){
 if(!useProxy)return queryDirect();
 let r;
 try{
  r=await fetch('/api/properties',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(credentials),signal:AbortSignal.timeout(10000)});
 }catch(e){
  // 本机服务端被关掉（黑窗口关了）时，连续失败几次就自动改为浏览器直连 OneNET，避免页面只剩「查询失败」。
  if(++proxyFails>=3){useProxy=false;serverMode=false;serverStatus=null;renderServerPill();renderState();setNotice('warn','连不上本机服务端（可能黑窗口已关闭），已自动改为浏览器直连 OneNET：页面仍可查看数据，但后台采集与历史已停止。');return queryDirect();}
  throw e;
 }
 proxyFails=0;
 const type=r.headers.get('content-type')||'';
 // 静态托管下该路径返回 404/HTML，说明没有服务端代理解析，自动切换为浏览器直连。
 if(r.status===404||r.status===405||!type.includes('json')){useProxy=false;return queryDirect();}
 return parseResult(await r.json(),r.ok);
}
// 设备在线状态：OneNET /device/detail（status=1 在线，0 离线）；静态托管下同样自动降级为直连。
function parseDevice(result,ok){if(!ok||result.code!==0)return 'unknown';const s=(result.data||{}).status;if(s===1||s===true||s==='1'||s==='online')return 'online';if(s===0||s===false||s==='0'||s==='offline')return 'offline';return 'unknown';}
async function queryDeviceDirect(){const url=new URL('https://iot-api.heclouds.com/device/detail');url.searchParams.set('product_id',credentials.productId);url.searchParams.set('device_name',credentials.deviceName);const r=await fetch(url,{headers:{Authorization:credentials.token},signal:AbortSignal.timeout(10000)});return parseDevice(await r.json(),r.ok);}
async function queryDevice(){if(!useProxy)return queryDeviceDirect();const r=await fetch('/api/device',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(credentials),signal:AbortSignal.timeout(10000)});const type=r.headers.get('content-type')||'';if(r.status===404||r.status===405||!type.includes('json')){useProxy=false;return queryDeviceDirect();}return parseDevice(await r.json(),r.ok);}
// 顶部状态机：未配置 / 连接中 / 设备在线 / 设备离线 / 查询失败 / 演示数据 / 后台暂停
function renderState(){const node=$('#state');let kind='idle',text='未配置 OneNET';
 if(demo){kind='demo';text='演示数据（非设备数据）';}
 else if(!credentials){if(serverStatus&&serverStatus.collecting){kind='demo';text='服务端常驻采集中';}else{kind='idle';text='未配置 OneNET';}}
 else if(document.hidden){kind='warn';text='后台暂停';}
 else if(connError){kind='error';text='查询失败';}
 else if(!lastResponse){kind='warn';text='连接中…';}
 else if(deviceState==='online'){kind='ok';text='设备在线';}
 else if(deviceState==='offline'){kind='warn';text='设备离线';}
 else{kind='ok';text='查询成功';}
 node.dataset.kind=kind;node.textContent=text;
 node.title=(demo?'演示模式：数据为模拟生成':(!credentials?'点击填写 OneNET 连接参数':(connError?connError:'最近查询 '+(lastResponse?time(lastResponse):'—'))))+(serverMode?'（历史由服务端常驻采集提供）':((!useProxy&&location.protocol!=='file:')?'（本机服务端已断开，正在浏览器直连 OneNET）':''));
 renderBindInfo();
}
// 顶栏设备标签：只显示产品 ID / 设备名（绝不显示 Token），点击打开连接设置
function renderBindInfo(){const node=$('#bindChip');if(!node)return;const c=credentials||loadCredentials(),label=node.querySelector('.id');
 if(c){node.dataset.kind='bound';label.textContent=c.productId+' / '+c.deviceName;node.title='已绑定 '+c.productId+' / '+c.deviceName+(credentials?(deviceState==='online'?'（设备在线）':deviceState==='offline'?'（设备离线）':'（已连接）'):'（已保存，尚未连接，点击连接）')+' · 点击修改';}
 else{node.dataset.kind='idle';label.textContent='未配置设备';node.title='点击填写 OneNET 连接参数（产品 ID / 设备名 / Token）';}}
// 服务端常驻采集：有服务端时用它的历史填充曲线，页面关闭期间的缺口也能补齐。
let serverMode=false,serverStatus=null,serverPollMs=0,proxyFails=0;
async function fetchServerHistory(minutes){
 if(!useProxy)return false;
 try{
  const r=await fetch('/api/history?minutes='+minutes,{signal:AbortSignal.timeout(8000)});
  const type=r.headers.get('content-type')||'';
  if(!r.ok||!type.includes('json'))return false;
  const j=await r.json();
  if(j.code!==0||!Array.isArray(j.data))return false;
  if(j.data.length)ingest(j.data);
  return true;
 }catch(e){return false;}
}
async function pingServer(){
 if(location.protocol==='file:'){serverMode=false;serverStatus=null;renderServerPill();renderState();return;}
 try{
  const r=await fetch('/api/status',{signal:AbortSignal.timeout(5000)});
  const t=r.headers.get('content-type')||'',ok=r.ok&&t.includes('json');
  if(ok){serverMode=true;useProxy=true;proxyFails=0;serverStatus=(await r.json()).data||null;}
  else{serverMode=false;serverStatus=null;}
 }catch(e){serverMode=false;serverStatus=null;}
 serverPollMs=serverStatus&&Number(serverStatus.pollMs)||0;
 if(serverMode)await fetchServerHistory(Math.max(5,Math.round(windowMs/60000)));
 renderServerPill();renderState();
}
// 工具行里的服务端采集指示：一眼看出是否真在采、已采多少条。
function renderServerPill(){const node=$('#server');if(!node)return;
 // 没有服务端时（静态托管 / 直接打开 / 服务端已关闭）不显示服务端历史相关控件
 document.querySelectorAll('#historyRange,#exportHistory').forEach(n=>{n.hidden=!serverMode;});
 if(!serverMode){node.hidden=true;return;}const s=serverStatus||{};node.hidden=false;
 if(s.owner===false){node.dataset.kind='warn';node.textContent='后台由另一个窗口负责';node.title='检测到另一个 LabScope 窗口负责后台采集，本窗口不重复采集。是否真在采集请看那个窗口的提示；建议只保留一个 start.bat 窗口。';return;}
 if(s.collecting){node.dataset.kind='ok';node.textContent='后台也在采集 · '+Number(s.records||0).toLocaleString()+' 条';node.title='后台（start.bat 那个黑窗口）每 '+s.pollMs+'ms 查询一次并存历史，关掉本页面也不会中断。点这里可以停止采集，或直接关闭 start.bat 窗口。'+(s.lastError?('最近一次失败：'+s.lastError):(s.lastAt?('最近 '+time(s.lastAt)):''));return;}
 node.dataset.kind='idle';node.textContent='后台未采集 · 点此开启';node.title='现在只有这个页面在查询（每秒一次），关掉页面就会停，这段时间的曲线只能标成虚线。点这里可以让后台（start.bat 窗口）也一起采，需要 OneNET 凭据。';}
// 后台采集是「显式开启」的：默认只有本页面在采，点工具的提示才会把凭据交给服务端。
let wantBackground=false;
$('#server').onclick=async()=>{if(!serverMode)return;const s=serverStatus||{};
 if(s.collecting){if(!confirm('停止后台采集？\n已保存的历史不受影响；之后只有本页面在采（关掉页面就会停）。'))return;
  try{await fetch('/api/credentials',{method:'DELETE',signal:AbortSignal.timeout(8000)});}catch(e){}
  setNotice('info','已停止后台采集：现在只有本页面在查询，关掉页面就会停。');pingServer();return;}
 if(credentials){await shareCredentials();setNotice('info','已开启后台采集：关掉本页面后仍会继续记录，历史保存在服务端 data/history.jsonl。');}
 else{wantBackground=true;$('#connection').showModal();setNotice('warn','开启后台采集需要 OneNET 凭据：请在下方填写并连接，连接后会自动开启后台采集。');}};
// 把页面里填写的凭据交给服务端，使其在页面关闭后仍能继续采集（仅存内存）。
async function shareCredentials(){
 if(!useProxy||!credentials)return;
 try{const r=await fetch('/api/credentials',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(credentials),signal:AbortSignal.timeout(8000)});if(r.ok){serverMode=true;pingServer();}}catch(e){}
}
async function poll(){if(busy||document.hidden||(!credentials&&!demo))return;busy=true;clearTimeout(timer);$('#refresh').disabled=true;try{let data;if(demo){const t=Date.now();data=widgets.map(w=>({identifier:w.key,time:t,value:demoValue(w.key,t)}));}else{data=await queryProperties();if(pollTick++%10===0){try{deviceState=await queryDevice();}catch(err){deviceState='unknown';}}}lastResponse=Date.now();connError='';ingest(data);$('#last').textContent=`最近查询 ${time(lastResponse)}`;setNotice(demo?'demo':'',demo?'演示模式：数据为模拟生成，不代表OneNET设备。':'');}catch(e){connError=e.message||String(e);setNotice('error',e.name==='TimeoutError'?'请求超时，稍后自动重试':e.message);}finally{busy=false;$('#refresh').disabled=false;renderState();if(!document.hidden)timer=setTimeout(poll,1000);}}
function resetSession(){latest={};records=[];seen.clear();pauseAt=null;deviceState='unknown';connError='';lastResponse=0;update();}
function openConnectionDialog(){const f=$('#connectionForm'),saved=loadCredentials(),c=credentials||saved||{};f.elements.productId.value=c.productId||'';f.elements.deviceName.value=c.deviceName||'';f.elements.token.value=c.token||'';let pref=true;try{pref=localStorage.getItem('labscope.remember')!=='0';}catch(err){}f.elements.remember.checked=saved?true:pref;$('#forget').hidden=!saved;$('#connection').showModal();}
$('#connect').onclick=openConnectionDialog;
$('#forget').onclick=()=>{saveCredentials(null);credentials=null;clearTimeout(timer);const f=$('#connectionForm');f.elements.productId.value='';f.elements.deviceName.value='';f.elements.token.value='';f.elements.remember.checked=true;$('#forget').hidden=true;resetSession();renderState();setNotice('warn','已清除本浏览器保存的连接信息，刷新后需重新填写。');};
$('#connectionForm').onsubmit=e=>{e.preventDefault();if(busy){setNotice('warn','正在完成上一次查询，请稍后连接');return;}const f=$('#connectionForm'),remember=!!f.elements.remember.checked,raw=Object.fromEntries([...new FormData(e.target)].map(([k,v])=>[k,String(v).trim()]));credentials={productId:raw.productId,deviceName:raw.deviceName,token:raw.token};saveCredentials(remember?credentials:null);try{localStorage.setItem('labscope.remember',remember?'1':'0');}catch(err){}const bg=wantBackground;wantBackground=false;demo=false;resetSession();$('#connection').close();renderState();poll();if(bg)shareCredentials();setNotice('info',remember?'已连接，连接信息已保存在本浏览器，下次打开会自动连接。':'已连接（未保存连接信息，刷新后需重新填写）。');};
// 用户取消（未提交）时不要留下「想开后后台采集」的意图，避免之后一次普通连接意外开启后台
$('#connection').addEventListener('close',()=>{wantBackground=false;});
$('#demo').onclick=()=>{if(busy)return;if(records.length&&!confirm('切换模式会清空本次记录，请先导出。继续？'))return;demo=!demo;credentials=null;resetSession();clearTimeout(timer);if(demo)poll();else{const c=loadCredentials();if(c){credentials=c;setNotice('info','已恢复保存的连接信息并重新连接。');poll();}else{renderState();setNotice('info','演示已结束，请配置 OneNET 连接');}}};
$('#refresh').onclick=()=>{if(!credentials&&!demo){setNotice('warn','尚未配置 OneNET 连接：请先点「连接设置」填写凭据，或点「演示模式」预览。');return;}poll();};document.addEventListener('visibilitychange',()=>{if(document.hidden){markHidden();clearTimeout(timer);renderState();if(!(serverMode&&serverStatus&&serverStatus.collecting))setNotice('warn',serverMode?'已切到后台，本页暂停查询。当前后台也没在采集，这段时间回来后会以虚线标注；点工具行的「后台未采集 · 点此开启」可让后台持续记录。':'已切到后台，本页暂停查询，这段时间回来后会以虚线标注。若希望关掉页面也不中断，请用 http://localhost:<端口>/ 打开并开启后台采集。');}else{const away=hiddenSince?Date.now()-hiddenSince:0;markVisible();if(serverMode)fetchServerHistory(Math.max(5,Math.round(windowMs/60000),Math.ceil(away/60000)+1));poll();}});
$('#trendPause').onclick=()=>{pauseAt=pauseAt?null:Date.now();setPauseLabel();drawTrend();};
$('#axisMin').onchange=applyAxis;$('#axisMax').onchange=applyAxis;
$('#windowSelect').onchange=e=>setWindow(Number(e.target.value));
// 纵轴自适应：只是个开关，不修改已填写的上下限
$('#axisAuto').onclick=()=>{const w=widgets.find(x=>x.id===selectedId);if(!w)return;w.auto=w.auto!==true;persist();syncAxisInputs();update();setNotice('info',w.auto?('已开启「'+w.name+'」纵轴自适应：先按数据缩放，上下限数值仍保留，关掉即刻恢复。'):('已关闭纵轴自适应：「'+w.name+'」恢复使用上下限。'));};
function fillColorSelect(current){const sel=$('#widgetForm').elements.color;sel.replaceChildren();const target=(current||'#3b82f6').trim(),list=COLORS.slice();let pick=list.find(([hex])=>hex.toLowerCase()===target.toLowerCase());if(!pick){pick=[/^#[0-9a-f]{6}$/i.test(target)?target:'#3b82f6'];pick[1]='自定义 ('+pick[0]+')';list.push(pick);}for(const [hex,label]of list){const o=document.createElement('option');o.value=hex;o.textContent=label;sel.append(o);}sel.value=pick[0];}
function renderIconPicker(selected){const box=$('#iconPicker');box.replaceChildren();for(const name of ICON_KEYS){const o=el('div',undefined,'icon-option');o.dataset.icon=name;o.title=name;o.tabIndex=0;o.setAttribute('role','button');o.setAttribute('aria-label','图标 '+name);o.append(icon(name));o.onclick=()=>selectIcon(name);o.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();selectIcon(name);}};box.append(o);}selectIcon(ICON_KEYS.includes(selected)?selected:'activity');}
function selectIcon(name){const f=$('#widgetForm');if(f.elements.icon)f.elements.icon.value=name;const p=$('#iconPreview');if(p)p.replaceChildren(icon(name));document.querySelectorAll('#iconPicker .icon-option').forEach(o=>o.classList.toggle('selected',o.dataset.icon===name));}
function edit(w=null){editing=w?.id||null;const f=$('#widgetForm');f.reset();fillColorSelect(w?w.color:nextUnused('color'));renderIconPicker(w?w.icon:nextUnused('icon'));if(w)for(const k of ['name','key','unit','decimals','min','max'])f.elements[k].value=w[k];$('#editorTitle').textContent=w?'编辑控件':'添加控件';$('#editorDelete').hidden=!w;$('#editor').showModal();}
$('#editorDelete').onclick=()=>{const i=widgets.findIndex(x=>x.id===editing);if(i<0)return;if(!confirm('删除此控件？平台属性和本次数据仍保留。'))return;widgets.splice(i,1);persist();$('#editor').close();render();};
$('#add').onclick=()=>edit();$('#widgetForm').onsubmit=e=>{e.preventDefault();try{const v=validate([Object.fromEntries(new FormData(e.target))])[0];if(editing){const prev=widgets.find(w=>w.id===editing);v.id=editing;if(prev)v.auto=prev.auto===true;widgets[widgets.findIndex(w=>w.id===editing)]=v;}else{if(widgets.length>=40)throw Error('最多40个控件');widgets.push(v);}persist();render();$('#editor').close();}catch(e){alert(e.message);}};
document.querySelectorAll('[data-close]').forEach(b=>b.onclick=()=>b.closest('dialog').close());
function download(name,content,type){const url=URL.createObjectURL(new Blob([content],{type}));const a=el('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
$('#save').onclick=()=>download('labscope-config.json',JSON.stringify({version:1,widgets},null,2),'application/json');
$('#import').onchange=async e=>{try{const file=e.target.files[0];if(!file)return;if(file.size>100000)throw Error('配置文件过大');const obj=JSON.parse(await file.text());const next=validate(obj.widgets);widgets=next;persist();render();}catch(e){alert(e.message);}finally{e.target.value='';}};
$('#export').onclick=()=>{const q=v=>'"'+String(v).replaceAll('"','""')+'"';download(`labscope-${demo?'demo-':''}${Date.now()}.csv`,'\ufeff'+[['source','identifier','platform_time','received_time','value'],...records.map(p=>[demo?'demo':'onenet',p.key,new Date(p.time).toISOString(),new Date(p.received).toISOString(),p.value])].map(row=>row.map(q).join(',')).join('\r\n'),'text/csv;charset=utf-8');};
// 导出服务端已落盘的历史（时间范围可选；仅在有服务端时可用）
$('#exportHistory').onclick=()=>{if(!serverMode)return;const sel=$('#historyRange'),a=el('a');a.href='/api/history.csv?minutes='+encodeURIComponent(sel.value);document.body.append(a);a.click();a.remove();setNotice('info','正在导出服务端历史（'+sel.options[sel.selectedIndex].textContent+'）…');};
$('#state').onclick=()=>{if(!demo)openConnectionDialog();};
$('#bindChip').onclick=openConnectionDialog;
$('#aboutReset').onclick=()=>{if(!confirm('清除本浏览器保存的控件配置与连接信息？（服务端 data/history.jsonl 与 OneNET 平台数据不受影响）'))return;try{Object.keys(localStorage).filter(k=>k.indexOf('labscope.')===0).forEach(k=>localStorage.removeItem(k));}catch(e){}credentials=null;demo=false;widgets=defaults.slice();selectedId=null;pauseAt=null;hideSpans=[];hiddenSince=null;clearTimeout(timer);resetSession();render();renderState();$('#aboutDialog').close();setNotice('info','已清除本机缓存并恢复默认控件与连接状态。');};
// 关于：署名 + 当前运行状态一览
function fillAbout(){const box=$('#aboutList');if(!box)return;const saved=loadCredentials(),bound=credentials||saved;
 // 判断当前是「本机运行」还是「网页版」：有服务端回应，或地址是本机/局域网
 const localMode=serverMode||(location.protocol!=='file:'&&/^(localhost|127\.0\.0\.1|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(location.hostname));
 $('#modeLocal').classList.toggle('current',localMode);$('#modeWeb').classList.toggle('current',!localMode);
 $('#modeLocal').querySelector('.badge').hidden=!localMode;$('#modeWeb').querySelector('.badge').hidden=localMode;
 const rows=[
  ['现在用的是',localMode?'本机运行':'网页版'],
  ['后台记录',serverMode?(serverStatus&&serverStatus.collecting?('正在记录（已存 '+Number(serverStatus.records||0).toLocaleString()+' 条）'):'未开启，可在工具行点「后台未采集 · 点此开启」'):'网页版没有这个功能'],
  ['登录信息',credentials?(saved?'已连接，并已记住（下次自动连接）':'已连接（未记住，刷新需重填）'):(saved?'已记住，但还没连上':'还没填写')],
  ['绑定的设备',bound?(bound.productId+' / '+bound.deviceName):'未配置'],
  ['卡片数量',widgets.length+' 个'],
  ['本次已记录',records.length+' 条（工具行的「导出本次记录」就是这个）']
 ];box.replaceChildren();for(const [k,v] of rows){const r=el('div',undefined,'about-row');r.append(el('span',k,'about-key'),el('span',v,'about-val'));box.append(r);}}
$('#about').onclick=()=>{fillAbout();$('#aboutDialog').showModal();};

if(!$('#notice').textContent){
 if(!credentials&&!demo)setNotice('info','尚未配置 OneNET 连接：点顶部状态或「连接设置」填写产品 ID、设备名与 Token，也可以先点「演示模式」预览界面。'+(location.protocol==='file:'?'（直接打开模式：浏览器直连 OneNET 查询，Token 只在本页内存）':''));
 else if(location.protocol==='file:')setNotice('info','直接打开模式：数据由浏览器直连 OneNET 查询，Token 仅保存在本页内存；此模式无法使用服务端的常驻采集历史，切到后台会缺数据，已启动服务端时请改用 http://localhost:<端口>/ 访问。');
}
renderWindowLabels();
renderState();
pingServer();
setInterval(pingServer,15000);
window.addEventListener('resize',update);render();
// 本浏览器保存过连接信息 → 打开页面即自动连接（并交给服务端常驻采集）
const savedCred=loadCredentials();
if(savedCred){credentials=savedCred;setNotice('info','已使用本浏览器保存的连接信息自动连接；如需清除，请打开「连接设置」点「清除已保存」。');poll();}
