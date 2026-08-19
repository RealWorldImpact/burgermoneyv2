(function(){
  'use strict';

  const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
  const APPROVAL_TOPIC = '0x8c5be1e5ebec7d5bd14f71427d1e84f3dd0314c0f7b2291e5b200ac8c7c3b925';
  const BASE = {
    idHex:'0x2105',
    params:{
      chainId:'0x2105',
      chainName:'Base',
      nativeCurrency:{name:'Ether',symbol:'ETH',decimals:18},
      rpcUrls:['https://mainnet.base.org'],
      blockExplorerUrls:['https://basescan.org']
    }
  };
  const RPCS = ['https://mainnet.base.org','https://base.llamarpc.com','https://base-rpc.publicnode.com','https://base.drpc.org'];
  const LOG_RANGE = 9999;
  const ENCODE_BASE = 1000n;
  const CANONICAL_TOKEN = '0x06a05043eb2c1691b19c2c13219db9212269ddc5';
  const ROUND_CONTROLLER = '0x9cd7c9196a4c1836a3df089cb210272e07e6a5e5';
  const VOTE_INBOX = '0x42555247564f5445000000000000000000000000';
  const WRITE_IN_INBOX = '0x4255524757524954450000000000000000000000';
  const ROUND_CONTROL_SPENDER = '0x42555247524f554e440000000000000000000000';
  const ROUND_BLOCK_BASE = 1000000000n;
  const BASENAME_REGISTRY = '0xb94704422c2a1e396835a571837aa5ae53285a95';
  const BASENAME_REVERSE_REGISTRAR = '0x79ea96012eea67a83431f1701b3dff7e37f9e282';
  const BASENAME_RESOLVERS = new Set([
    '0xc6d566a56a1aff6508b41f6c90ff131615583bcd',
    '0x426fa03fb86e510d0dd9f70335cf102a98b10875'
  ]);
  const BASE_ETH_NAMEHASH = '0xff1e3c0eb00ec714e34b6114125fbde1dea2f24a72fbf672e7b7fd5690328e10';
  const BASENAME_AVATAR_GATEWAY = 'https://gateway.pinata.cloud/ipfs/';
  const BASENAME_AVATAR_THUMBNAIL = 'https://res.cloudinary.com/base-web/image/fetch/w_128/f_webp/';

  const state = {
    config:null,
    baseConfig:null,
    roundGate:null,
    orgs:[],
    byId:new Map(),
    wallet:null,
    account:null,
    onBase:false,
    power:0n,
    providers:[],
    candidates:[],
    nominations:[],
    votes:[],
    basenames:new Map(),
    avatars:new Map(),
    basenamePending:new Set(),
    selected:null,
    writeInChoice:null,
    pendingWriteIn:false,
    advancing:false,
    loading:false,
    refreshSeq:0
  };

  const $ = id => document.getElementById(id);
  const lower = value => String(value || '').toLowerCase();
  const short = value => value ? value.slice(0,6) + '…' + value.slice(-4) : '';
  const hexNumber = value => '0x' + BigInt(value).toString(16);
  const toNumber = value => Number(BigInt(value || '0x0'));
  const topicAddress = value => '0x' + lower(value).replace(/^0x/,'').padStart(64,'0');
  const fromTopic = value => '0x' + String(value || '').replace(/^0x/,'').slice(-40);
  const sleep = ms => new Promise(resolve => setTimeout(resolve,ms));
  const regionNames = typeof Intl.DisplayNames === 'function' ? new Intl.DisplayNames(['en'],{type:'region'}) : null;
  const countryName = code => {
    try{ return regionNames ? regionNames.of(code) : code; }
    catch(error){ return code; }
  };

  function slugFromUrl(url){
    try{ return new URL(url).pathname.split('/').filter(Boolean).pop().toLowerCase(); }
    catch(e){ return ''; }
  }
  function validAddress(value){ return /^0x[0-9a-fA-F]{40}$/.test(String(value || '')); }
  function formatToken(units){
    units = BigInt(units || 0);
    const whole = Number(units / (10n ** 18n));
    if(whole >= 1e9) return (whole/1e9).toFixed(2) + 'B';
    if(whole >= 1e6) return (whole/1e6).toFixed(2) + 'M';
    if(whole >= 1e3) return (whole/1e3).toFixed(1) + 'K';
    return whole.toLocaleString('en-US');
  }
  function formatPercent(part,total){
    if(total <= 0n) return '0.0%';
    const basis = Number((part * 1000n) / total) / 10;
    return basis.toFixed(1) + '%';
  }
  function setStatus(message,type){
    const el = $('ballotStatus');
    el.textContent = message || '';
    el.className = 'vote-status' + (type ? ' is-' + type : '');
  }
  function toast(message,isError){
    const el = $('voteToast');
    el.textContent = message;
    el.className = 'vote-toast' + (isError ? ' is-error' : '');
    el.hidden = false;
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => { el.hidden = true; },4200);
  }

  function fetchDeadline(url,options,ms){
    return new Promise((resolve,reject) => {
      const timer = setTimeout(() => reject(new Error('Request timed out')),ms);
      fetch(url,options).then(
        response => { clearTimeout(timer); resolve(response); },
        error => { clearTimeout(timer); reject(error); }
      );
    });
  }
  let rpcIndex = 0;
  async function rpc(method,params){
    let lastError;
    for(let offset=0;offset<RPCS.length;offset++){
      const index = (rpcIndex + offset) % RPCS.length;
      try{
        const response = await fetchDeadline(RPCS[index],{
          method:'POST',
          headers:{'content-type':'application/json'},
          body:JSON.stringify({jsonrpc:'2.0',id:Date.now(),method,params})
        },12000);
        const json = await response.json();
        if(json && Object.prototype.hasOwnProperty.call(json,'result')){ rpcIndex = index; return json.result; }
        if(json && json.error) lastError = new Error(json.error.message || 'RPC error');
      }catch(error){ lastError = error; }
    }
    throw lastError || new Error('Base RPC unavailable');
  }
  async function rpcBatch(calls){
    let lastError;
    const body = calls.map((call,index) => ({jsonrpc:'2.0',id:index,method:call.method,params:call.params}));
    for(let offset=0;offset<RPCS.length;offset++){
      const index = (rpcIndex + offset) % RPCS.length;
      try{
        const response = await fetchDeadline(RPCS[index],{
          method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)
        },15000);
        const json = await response.json();
        if(!Array.isArray(json)) throw new Error('Invalid batch response');
        const byId = new Map(json.map(item => [item.id,item]));
        const results = calls.map((_,i) => byId.get(i) && byId.get(i).result !== undefined ? byId.get(i).result : null);
        if(results.every(result => result !== null)){ rpcIndex = index; return results; }
      }catch(error){ lastError = error; }
    }
    throw lastError || new Error('Base batch RPC unavailable');
  }
  async function rpcBatchLoose(calls){
    if(!calls.length) return [];
    let lastError;
    const body = calls.map((call,index) => ({jsonrpc:'2.0',id:index,method:call.method,params:call.params}));
    for(let offset=0;offset<RPCS.length;offset++){
      const index = (rpcIndex + offset) % RPCS.length;
      try{
        const response = await fetchDeadline(RPCS[index],{
          method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)
        },15000);
        const json = await response.json();
        if(!Array.isArray(json)) throw new Error('Invalid batch response');
        const byId = new Map(json.map(item => [item.id,item]));
        const results=calls.map((_,i) => {
          const item=byId.get(i);
          return item && item.result !== undefined ? item.result : null;
        });
        if(results.some(result => result !== null)){ rpcIndex = index; return results; }
        lastError=new Error('RPC batch returned no results');
      }catch(error){ lastError = error; }
    }
    throw lastError || new Error('Base batch RPC unavailable');
  }
  async function tokenBalance(address){
    if(!validAddress(address)) return 0n;
    const data = '0x70a08231' + lower(address).replace(/^0x/,'').padStart(64,'0');
    const result = await rpc('eth_call',[{to:state.config.token,data},'latest']);
    return BigInt(result || '0x0');
  }
  async function tokenBalances(addresses){
    const unique = [...new Set(addresses.map(lower).filter(validAddress))];
    const output = new Map();
    for(let start=0;start<unique.length;start+=80){
      const batch = unique.slice(start,start+80);
      const calls = batch.map(address => ({method:'eth_call',params:[{
        to:state.config.token,
        data:'0x70a08231' + address.replace(/^0x/,'').padStart(64,'0')
      },'latest']}));
      let results;
      try{ results = await rpcBatch(calls); }
      catch(error){ results = await Promise.all(batch.map(address => tokenBalance(address).catch(() => 0n))); }
      batch.forEach((address,index) => {
        const value = results[index];
        output.set(address,typeof value === 'bigint' ? value : BigInt(value || '0x0'));
      });
    }
    return output;
  }

  function decodeAddressWord(value){
    if(!/^0x[0-9a-fA-F]{64}$/.test(String(value || ''))) return null;
    const address='0x'+String(value).slice(-40).toLowerCase();
    return /^0x0{40}$/.test(address) ? null : address;
  }
  function decodeAbiText(value,maxLength){
    try{
      const hex=String(value || '').replace(/^0x/,'');
      if(!/^[0-9a-fA-F]+$/.test(hex) || hex.length<128) return null;
      const offset=Number(BigInt('0x'+hex.slice(0,64)));
      const lengthAt=offset*2;
      if(!Number.isSafeInteger(offset) || lengthAt+64>hex.length) return null;
      const length=Number(BigInt('0x'+hex.slice(lengthAt,lengthAt+64)));
      if(!Number.isSafeInteger(length) || length<1 || length>maxLength || lengthAt+64+length*2>hex.length) return null;
      const bytes=new Uint8Array(length);
      const start=lengthAt+64;
      for(let index=0;index<length;index++) bytes[index]=parseInt(hex.slice(start+index*2,start+index*2+2),16);
      const text=new TextDecoder('utf-8',{fatal:true}).decode(bytes).trim();
      return text && !/[\u0000-\u001f\u007f]/.test(text) ? text : null;
    }catch(error){ return null; }
  }
  function decodeAbiString(value){
    const name=decodeAbiText(value,255);
    return name && lower(name).endsWith('.base.eth') ? name : null;
  }
  function utf8Hex(value){
    return '0x'+[...new TextEncoder().encode(String(value))].map(byte => byte.toString(16).padStart(2,'0')).join('');
  }
  function safeAvatarUrl(value){
    const raw=String(value || '').trim();
    if(!raw || raw.length>2048) return null;
    if(/^ipfs:\/\//i.test(raw)){
      let path=raw.replace(/^ipfs:\/\//i,'').replace(/^ipfs\//i,'');
      const parts=path.split('/').filter(Boolean);
      if(!parts.length || !/^[a-zA-Z0-9]{32,}$/.test(parts[0])) return null;
      try{ path=parts.map(part => encodeURIComponent(decodeURIComponent(part))).join('/'); }
      catch(error){ return null; }
      return BASENAME_AVATAR_GATEWAY+path;
    }
    try{
      const url=new URL(raw);
      return url.protocol==='https:' && url.hostname==='gateway.pinata.cloud' && url.pathname.startsWith('/ipfs/') ? url.href : null;
    }catch(error){ return null; }
  }
  function basenameAvatarThumbnail(value){
    return BASENAME_AVATAR_THUMBNAIL+encodeURIComponent(value);
  }
  async function basenameNamehashes(names){
    const unique=[...new Set(names.map(lower).filter(name => name.endsWith('.base.eth')))];
    const records=unique.map(name => {
      const parts=name.split('.');
      const valid=parts.length>=3 && parts.at(-2)==='base' && parts.at(-1)==='eth' && parts.slice(0,-2).every(Boolean);
      return {name,labels:valid ? parts.slice(0,-2).reverse() : [],node:valid ? BASE_ETH_NAMEHASH : null};
    });
    const depth=Math.max(0,...records.map(record => record.labels.length));
    for(let level=0;level<depth;level++){
      const active=records.filter(record => record.node && record.labels[level]);
      if(!active.length) continue;
      const labelHashes=await rpcBatchLoose(active.map(record => ({method:'web3_sha3',params:[utf8Hex(record.labels[level])]})));
      const nodeHashes=await rpcBatchLoose(active.map((record,index) => {
        const labelHash=String(labelHashes[index] || '');
        const data=/^0x[0-9a-fA-F]{64}$/.test(labelHash) ? '0x'+record.node.slice(2)+labelHash.slice(2) : '0x';
        return {method:'web3_sha3',params:[data]};
      }));
      active.forEach((record,index) => {
        const labelHash=String(labelHashes[index] || '');
        const nodeHash=String(nodeHashes[index] || '');
        record.node=/^0x[0-9a-fA-F]{64}$/.test(labelHash) && /^0x[0-9a-fA-F]{64}$/.test(nodeHash) ? lower(nodeHash) : null;
      });
    }
    return new Map(records.map(record => [record.name,record.node]));
  }
  function encodeTextCall(node,key){
    const keyHex=utf8Hex(key).slice(2);
    const paddedLength=Math.ceil(keyHex.length/64)*64;
    return '0x59d1d43c'+node.replace(/^0x/,'')+(64).toString(16).padStart(64,'0')+(keyHex.length/2).toString(16).padStart(64,'0')+keyHex.padEnd(paddedLength,'0');
  }
  async function readBasenameAvatars(names){
    const unique=[...new Set(names.map(lower).filter(Boolean))];
    const output=new Map(unique.map(name => [name,null]));
    if(!unique.length) return output;
    const nodes=await basenameNamehashes(unique);
    const resolverWords=await rpcBatchLoose(unique.map(name => {
      const node=nodes.get(name);
      return {method:'eth_call',params:[{to:BASENAME_REGISTRY,data:'0x0178b8bf'+String(node || '').replace(/^0x/,'').padStart(64,'0')},'latest']};
    }));
    const resolvers=resolverWords.map(decodeAddressWord);
    const calls=[]; const indexes=[];
    unique.forEach((name,index) => {
      const node=nodes.get(name); const resolver=resolvers[index];
      if(!node || !resolver || !BASENAME_RESOLVERS.has(resolver)) return;
      indexes.push(index); calls.push({method:'eth_call',params:[{to:resolver,data:encodeTextCall(node,'avatar')},'latest']});
    });
    if(!calls.length) return output;
    const values=await rpcBatchLoose(calls);
    indexes.forEach((nameIndex,resultIndex) => output.set(unique[nameIndex],safeAvatarUrl(decodeAbiText(values[resultIndex],2048))));
    return output;
  }
  async function readBasenames(addresses){
    const unique=[...new Set(addresses.map(lower).filter(validAddress))];
    if(!unique.length) return new Map();
    const nodes=await rpcBatchLoose(unique.map(address => ({method:'eth_call',params:[{
      to:BASENAME_REVERSE_REGISTRAR,
      data:'0xbffbe61c'+address.replace(/^0x/,'').padStart(64,'0')
    },'latest']})));
    const resolverWords=await rpcBatchLoose(nodes.map(node => ({method:'eth_call',params:[{
      to:BASENAME_REGISTRY,
      data:'0x0178b8bf'+String(node || '').replace(/^0x/,'').padStart(64,'0')
    },'latest']})));
    const resolvers=resolverWords.map(decodeAddressWord);
    const lookups=[];
    const lookupIndexes=[];
    resolvers.forEach((resolver,index) => {
      if(!resolver || !BASENAME_RESOLVERS.has(resolver) || !/^0x[0-9a-fA-F]{64}$/.test(String(nodes[index] || ''))) return;
      lookupIndexes.push(index);
      lookups.push({method:'eth_call',params:[{to:resolver,data:'0x691f3431'+String(nodes[index]).replace(/^0x/,'')},'latest']});
    });
    const names=await rpcBatchLoose(lookups);
    const output=new Map(unique.map(address => [address,null]));
    lookupIndexes.forEach((addressIndex,resultIndex) => output.set(unique[addressIndex],decodeAbiString(names[resultIndex])));
    return output;
  }
  async function refreshBasenames(addresses){
    const missing=[...new Set(addresses.map(lower).filter(address => validAddress(address) && !state.basenames.has(address) && !state.basenamePending.has(address)))];
    if(!missing.length){ renderVoters(); return; }
    missing.forEach(address => state.basenamePending.add(address));
    renderVoters();
    try{
      const resolved=await readBasenames(missing);
      missing.forEach(address => state.basenames.set(address,resolved.get(address) || null));
      renderVoters();
      try{
        const avatars=await readBasenameAvatars([...resolved.values()].filter(Boolean));
        missing.forEach(address => {
          const name=resolved.get(address);
          state.avatars.set(address,name ? avatars.get(lower(name)) || null : null);
        });
      }catch(error){ missing.forEach(address => state.avatars.set(address,null)); }
    }catch(error){
      missing.forEach(address => { state.basenames.set(address,null); state.avatars.set(address,null); });
    }finally{
      missing.forEach(address => state.basenamePending.delete(address));
      renderVoters();
    }
  }

  async function tokenAllowance(owner,spender){
    const data = '0xdd62ed3e' + lower(owner).replace(/^0x/,'').padStart(64,'0') + lower(spender).replace(/^0x/,'').padStart(64,'0');
    const result = await rpc('eth_call',[{to:CANONICAL_TOKEN,data},'latest']);
    return BigInt(result || '0x0');
  }
  async function resolveControlledRound(){
    if(!state.baseConfig) return;
    state.config = Object.assign({},state.baseConfig);
    state.roundGate = null;
    const encoded = await tokenAllowance(ROUND_CONTROLLER,ROUND_CONTROL_SPENDER);
    const round = Number(encoded / ROUND_BLOCK_BASE);
    const anchor = Number(encoded % ROUND_BLOCK_BASE);
    if(!Number.isSafeInteger(round) || round <= state.baseConfig.round) return;
    const latest = toNumber(await rpc('eth_blockNumber',[]));
    if(anchor < state.baseConfig.startBlock || anchor > latest) throw new Error('Invalid developer round anchor');
    const filter = {
      address:CANONICAL_TOKEN,
      fromBlock:hexNumber(anchor),
      toBlock:hexNumber(Math.min(latest,anchor+LOG_RANGE)),
      topics:[APPROVAL_TOPIC,topicAddress(ROUND_CONTROLLER),topicAddress(ROUND_CONTROL_SPENDER)]
    };
    const logs = await rpc('eth_getLogs',[filter]);
    const matches = (logs || []).filter(log => BigInt(log.data || '0x0') === encoded).map(log => ({
      block:toNumber(log.blockNumber),
      txIndex:toNumber(log.transactionIndex),
      logIndex:toNumber(log.logIndex),
      hash:log.transactionHash || ''
    })).sort(compareLogs);
    const gate = matches[matches.length-1];
    if(!gate) throw new Error('Developer round event was not found');
    state.config = Object.assign({},state.baseConfig,{
      round,
      status:'open',
      title:'Hunger Relief Community Ballot',
      startBlock:gate.block,
      openedAt:null
    });
    delete state.config.endBlock;
    state.roundGate = gate;
  }

  function normalizeLog(log,type){
    if(!log || !Array.isArray(log.topics) || log.topics.length < 3) return null;
    const amount = BigInt(log.data || '0x0');
    const round = Number(amount / ENCODE_BASE);
    const orgId = Number(amount % ENCODE_BASE);
    if(round !== state.config.round || !state.byId.has(orgId)) return null;
    return {
      type,
      round,
      orgId,
      address:lower(fromTopic(log.topics[1])),
      block:toNumber(log.blockNumber),
      txIndex:toNumber(log.transactionIndex),
      logIndex:toNumber(log.logIndex),
      hash:log.transactionHash || ''
    };
  }
  function compareLogs(a,b){ return a.block-b.block || a.txIndex-b.txIndex || a.logIndex-b.logIndex; }
  async function readBallotLogs(){
    const latest = state.config.endBlock || toNumber(await rpc('eth_blockNumber',[]));
    const start = Number(state.config.startBlock);
    if(!Number.isFinite(start) || start < 1 || latest < start) return {writeIns:[],votes:[]};
    const writeIns = [], votes = [];
    const token = state.config.token;
    const writeTopic = topicAddress(state.config.writeInInbox);
    const voteTopic = topicAddress(state.config.voteInbox);
    for(let from=start;from<=latest;from+=LOG_RANGE+1){
      const to = Math.min(latest,from+LOG_RANGE);
      const filters = [writeTopic,voteTopic].map(topic => ({
        address:token,fromBlock:hexNumber(from),toBlock:hexNumber(to),topics:[TRANSFER_TOPIC,null,topic]
      }));
      let pair;
      try{ pair = await rpcBatch(filters.map(filter => ({method:'eth_getLogs',params:[filter]}))); }
      catch(error){ pair = await Promise.all(filters.map(filter => rpc('eth_getLogs',[filter]).catch(() => []))); }
      (pair[0] || []).forEach(log => { const row=normalizeLog(log,'writein'); if(row) writeIns.push(row); });
      (pair[1] || []).forEach(log => { const row=normalizeLog(log,'vote'); if(row) votes.push(row); });
    }
    writeIns.sort(compareLogs); votes.sort(compareLogs);
    if(state.roundGate){
      return {
        writeIns:writeIns.filter(row => compareLogs(row,state.roundGate)>0),
        votes:votes.filter(row => compareLogs(row,state.roundGate)>0)
      };
    }
    return {writeIns,votes};
  }

  async function computeBallot(logs){
    const allAddresses = [...logs.writeIns,...logs.votes].map(row => row.address);
    const balances = await tokenBalances(allAddresses);
    const usedWallets = new Set(), usedOrgs = new Set(), nominations = [];
    for(const row of logs.writeIns){
      if((balances.get(row.address) || 0n) <= 0n) continue;
      if(usedWallets.has(row.address) || usedOrgs.has(row.orgId)) continue;
      usedWallets.add(row.address); usedOrgs.add(row.orgId); nominations.push(row);
      if(nominations.length >= state.config.slots) break;
    }
    const nominationsById = new Map(nominations.map(row => [row.orgId,row]));
    const latestVote = new Map();
    for(const row of logs.votes){
      const nomination=nominationsById.get(row.orgId);
      if(nomination && compareLogs(row,nomination)>0) latestVote.set(row.address,row);
    }
    const totals = new Map(nominations.map(row => [row.orgId,0n]));
    const votes = [];
    latestVote.forEach((row,address) => {
      const weight = balances.get(address) || 0n;
      if(weight > 0n) totals.set(row.orgId,(totals.get(row.orgId) || 0n) + weight);
      votes.push(Object.assign({},row,{weight}));
    });
    return {
      nominations,
      candidates:nominations.map(row => Object.assign({},state.byId.get(row.orgId),{
        nomination:row,
        total:totals.get(row.orgId) || 0n
      })),
      votes,
      totalWeight:[...totals.values()].reduce((sum,value) => sum+value,0n),
      balances
    };
  }

  function renderSlots(){
    const container = $('voteSlots');
    container.replaceChildren();
    const mine = state.account ? lower(state.account) : '';
    const myVote = state.votes.find(vote => vote.address === mine);
    for(let index=0;index<state.config.slots;index++){
      const candidate = state.candidates[index];
      const article = document.createElement('article');
      article.className = 'vote-slot';
      if(!candidate){
        article.classList.add('vote-slot-empty');
        article.innerHTML = '<img class="vote-slot-logo" src="icon-192.png" alt="" width="52" height="52"><div class="vote-slot-copy"><strong>Open community seat</strong><span>Waiting for a $BURGERS holder write-in</span></div><span class="vote-seat-open"></span>';
        article.querySelector('.vote-seat-open').textContent=canBrowseWriteIn()?'Write in →':'Unfilled';
        if(canBrowseWriteIn()){
          article.tabIndex = 0;
          article.setAttribute('role','button');
          article.setAttribute('aria-label','Fill an open community seat');
          article.addEventListener('click',openWriteIn);
          article.addEventListener('keydown',event => { if(event.key==='Enter' || event.key===' '){ event.preventDefault(); openWriteIn(); } });
        }
        container.appendChild(article);
        continue;
      }
      const percent = formatPercent(candidate.total,state.totalWeight);
      article.dataset.orgId = candidate.id;
      article.tabIndex = 0;
      article.setAttribute('role','radio');
      article.setAttribute('aria-checked',String(state.selected === candidate.id));
      article.setAttribute('aria-label',candidate.name + ', ' + percent + ', ' + formatToken(candidate.total) + ' BURGERS');
      if(state.selected === candidate.id) article.classList.add('is-selected');
      if(myVote && myVote.orgId === candidate.id) article.classList.add('is-mine');
      article.innerHTML = '<img class="vote-slot-logo" alt="" width="52" height="52" loading="lazy" decoding="async">' +
        '<div class="vote-slot-copy"><strong></strong><span><b></b><a target="_blank" rel="noopener">Giving Block profile ↗</a></span></div>' +
        '<div class="vote-result"><div class="vote-result-bar"><span></span></div><strong></strong><small></small></div>';
      const slotLogo=article.querySelector('.vote-slot-logo');
      slotLogo.src = candidate.logo;
      slotLogo.addEventListener('error',() => { slotLogo.src='icon-192.png'; slotLogo.classList.add('is-fallback'); },{once:true});
      article.querySelector('.vote-slot-copy strong').textContent = candidate.name;
      article.querySelector('.vote-slot-copy b').textContent = countryName(candidate.country);
      const link = article.querySelector('.vote-slot-copy a');
      link.href = candidate.url;
      link.addEventListener('click',event => event.stopPropagation());
      article.querySelector('.vote-result-bar span').style.width = percent;
      article.querySelector('.vote-result>strong').textContent = percent;
      article.querySelector('.vote-result small').textContent = formatToken(candidate.total) + ' $BURGERS';
      const choose = () => { state.selected = candidate.id; renderSlots(); updateActions(); };
      article.addEventListener('click',choose);
      article.addEventListener('keydown',event => { if(event.key==='Enter' || event.key===' '){ event.preventDefault(); choose(); } });
      container.appendChild(article);
    }
  }
  function renderVoters(){
    const container=$('voterList');
    if(!container) return;
    const votes=[...state.votes].sort((a,b) => a.weight===b.weight ? compareLogs(a,b) : (a.weight>b.weight?-1:1));
    $('voterCount').textContent=votes.length;
    $('voterCountLabel').textContent=votes.length===1?'voter':'voters';
    container.setAttribute('aria-busy',String(state.loading && !votes.length));
    container.replaceChildren();
    if(!votes.length){
      const empty=document.createElement('div');
      empty.className='vote-voters-empty'; empty.setAttribute('role','listitem');
      empty.innerHTML='<img src="icon-192.png" alt="" width="46" height="46"><div><strong>No votes on this ballot yet.</strong><span>The first confirmed vote will appear here automatically.</span></div>';
      container.appendChild(empty);
      return;
    }
    votes.forEach(vote => {
      const candidate=state.byId.get(vote.orgId);
      if(!candidate) return;
      const address=lower(vote.address);
      const basename=state.basenames.get(address);
      const avatarUrl=state.avatars.get(address);
      const pending=state.basenamePending.has(address);
      const row=document.createElement('article');
      row.className='vote-voter'; row.setAttribute('role','listitem');
      if(vote.weight<=0n) row.classList.add('is-zero');

      const identity=document.createElement('div'); identity.className='vote-voter-identity';
      const avatar=document.createElement('span'); avatar.className='vote-voter-avatar';
      const avatarImage=document.createElement('img'); avatarImage.src=avatarUrl || 'icon-192.png'; avatarImage.alt=basename && avatarUrl ? basename+' avatar' : ''; avatarImage.decoding='async'; avatarImage.referrerPolicy='no-referrer';
      const avatarPicture=document.createElement('picture');
      let avatarSource=null; let fallbackApplied=!avatarUrl;
      if(avatarUrl){ avatarSource=document.createElement('source'); avatarSource.media='(min-width:681px)'; avatarSource.srcset=basenameAvatarThumbnail(avatarUrl); avatarPicture.appendChild(avatarSource); }
      if(!avatarUrl) avatarImage.classList.add('is-fallback');
      avatarImage.addEventListener('error',() => {
        if(avatarSource && avatarSource.isConnected){ avatarSource.remove(); avatarImage.src=avatarUrl; return; }
        if(!fallbackApplied){ fallbackApplied=true; avatarImage.src='icon-192.png'; avatarImage.alt=''; avatarImage.classList.add('is-fallback'); }
      });
      avatarPicture.appendChild(avatarImage); avatar.appendChild(avatarPicture);
      const identityCopy=document.createElement('span');
      const addressLink=document.createElement('a'); addressLink.href='https://basescan.org/address/'+address; addressLink.target='_blank'; addressLink.rel='noopener';
      addressLink.textContent=basename || short(address); addressLink.setAttribute('aria-label',(basename ? basename+', wallet ' : 'Wallet ')+address+' on BaseScan');
      identityCopy.appendChild(addressLink);
      const identityMeta=document.createElement('small');
      identityMeta.textContent=basename ? short(address) : (pending ? 'Checking primary Base name…' : 'Base wallet');
      if(pending) identityMeta.classList.add('is-resolving');
      identityCopy.appendChild(identityMeta); identity.append(avatar,identityCopy);

      const choice=document.createElement('a'); choice.className='vote-voter-choice'; choice.href=candidate.url; choice.target='_blank'; choice.rel='noopener';
      const logo=document.createElement('img'); logo.src=candidate.logo; logo.alt=''; logo.width=36; logo.height=36; logo.loading='lazy'; logo.decoding='async';
      logo.addEventListener('error',() => { logo.src='icon-192.png'; logo.classList.add('is-fallback'); },{once:true});
      const choiceCopy=document.createElement('span'); const choiceLabel=document.createElement('small'); choiceLabel.textContent='Voted for'; const choiceName=document.createElement('strong'); choiceName.textContent=candidate.name; choiceCopy.append(choiceLabel,choiceName); choice.append(logo,choiceCopy);

      const weight=document.createElement('div'); weight.className='vote-voter-weight';
      const amount=document.createElement('strong'); amount.textContent=formatToken(vote.weight)+' $BURGERS';
      const transaction=document.createElement('a'); transaction.href='https://basescan.org/tx/'+vote.hash; transaction.target='_blank'; transaction.rel='noopener'; transaction.textContent='View vote ↗'; transaction.setAttribute('aria-label','View vote transaction on BaseScan');
      weight.append(amount,transaction);
      row.append(identity,choice,weight); container.appendChild(row);
    });
  }
  function renderRound(){
    $('roundState').textContent = state.config.status === 'open' ? 'Open' : 'Closed';
    $('directoryCount').textContent = state.orgs.length;
    $('heroDirectoryCount').textContent = state.orgs.length;
    $('writeInDirectoryCount').textContent = state.orgs.length;
    const voters = state.votes.length;
    const seats = state.candidates.length;
    $('roundSummary').textContent = seats + ' of ' + state.config.slots + ' seats filled · ' + voters + ' voting wallet' + (voters===1?'':'s') + ' · ' + formatToken(state.totalWeight) + ' $BURGERS signaling';
    if(state.config.status !== 'open') setStatus('This ballot is closed. Results remain visible.','');
    else if(!seats) setStatus('All five seats are open. Use the write-in panel below to browse the Hunger directory and nominate the first organization.','');
    else if(seats < state.config.slots) setStatus('Voting is live for every filled seat · ' + (state.config.slots-seats) + ' write-in seat' + (state.config.slots-seats===1?' remains':'s remain') + ' open.','ok');
    else setStatus('All five seats are filled. The ballot is live.','ok');
    renderSlots();
    renderVoters();
    updateActions();
  }
  function renderWallet(){
    const bar = document.querySelector('.vote-wallet-bar');
    const button = $('connectWallet');
    if(!state.account){
      bar.classList.remove('connected');
      $('walletHeadline').textContent = 'Connect to participate';
      $('walletDetail').textContent = 'Your wallet stays in control. Burger Money never asks for a seed phrase.';
      $('powerChip').hidden = true;
      button.textContent = 'Connect wallet';
    }else{
      bar.classList.add('connected');
      $('walletHeadline').textContent = short(state.account);
      $('walletDetail').textContent = state.onBase ? 'Connected on Base' : 'Connected · switch to Base to participate';
      $('powerChip').textContent = formatToken(state.power) + ' $BURGERS';
      $('powerChip').hidden = false;
      button.textContent = 'Disconnect';
    }
    renderDevControls();
    updateActions();
    if($('writeInDialog').open) updateWriteInAction();
  }
  function isDeveloper(){ return !!state.account && lower(state.account) === ROUND_CONTROLLER; }
  function renderDevControls(){
    const panel = $('devControls');
    if(!panel) return;
    panel.hidden = !isDeveloper();
    if(panel.hidden || !state.config) return;
    $('devRoundLabel').textContent = 'Current ballot is active';
    const button = $('advanceRound');
    button.textContent = state.advancing ? 'Starting fresh ballot…' : (state.onBase ? 'Start fresh ballot →' : 'Switch to Base & start fresh ballot →');
    button.disabled = state.advancing;
  }
  function hasNominated(){ return !!state.account && state.nominations.some(row => row.address === lower(state.account)); }
  function canWriteIn(){
    return !!state.config && state.config.status === 'open' && !!state.account && state.onBase && state.power > 0n && state.candidates.length < state.config.slots && !hasNominated();
  }
  function canBrowseWriteIn(){
    return !!state.config && state.config.status === 'open' && state.candidates.length < state.config.slots;
  }
  function updateActions(){
    const cast = $('castVote');
    const write = $('openWriteIn');
    const open = state.config && state.config.status === 'open';
    cast.disabled = !(open && state.account && state.onBase && state.power > 0n && state.selected && state.candidates.some(org => org.id === state.selected));
    if(!state.candidates.length) cast.textContent = 'Voting opens after the first write-in';
    else if(!state.selected) cast.textContent = 'Choose a charity to vote';
    else if(!state.account) cast.textContent = 'Connect wallet to vote';
    else if(!state.onBase) cast.textContent = 'Switch to Base to vote';
    else if(state.power <= 0n) cast.textContent = 'No $BURGERS voting power';
    else cast.textContent = 'Cast ' + formatToken(state.power) + ' $BURGERS vote';
    write.disabled = !canBrowseWriteIn();
    if(state.candidates.length >= (state.config ? state.config.slots : 5)) write.textContent = 'All five seats filled';
    else if(hasNominated()) write.textContent = 'Write-in already submitted';
    else write.textContent = 'Browse & write in →';
    renderDevControls();
  }

  async function refreshPower(){
    state.power = state.account ? await tokenBalance(state.account).catch(() => 0n) : 0n;
    renderWallet();
  }
  async function refreshBallot(options){
    if(state.loading && !(options && options.force)) return;
    state.loading = true;
    const seq = ++state.refreshSeq;
    $('refreshBallot').disabled = true;
    setStatus('Reading this ballot’s $BURGERS signals from Base…','');
    try{
      await resolveControlledRound();
      const logs = await readBallotLogs();
      const computed = await computeBallot(logs);
      if(seq !== state.refreshSeq) return;
      state.nominations = computed.nominations;
      state.candidates = computed.candidates;
      state.votes = computed.votes;
      state.totalWeight = computed.totalWeight;
      if(state.selected && !state.candidates.some(org => org.id === state.selected)) state.selected = null;
      await refreshPower();
      renderRound();
      refreshBasenames(state.votes.map(vote => vote.address));
    }catch(error){
      if(seq !== state.refreshSeq) return;
      setStatus('The Base RPC could not finish the tally. No partial result is being shown; try Refresh results.','error');
      renderVoters();
      toast('Could not read the complete ballot from Base.',true);
    }finally{
      if(seq === state.refreshSeq){ state.loading=false; $('refreshBallot').disabled=false; }
    }
  }

  function announceProvider(event){
    const detail = event.detail;
    if(!detail || !detail.provider) return;
    const key = detail.info && (detail.info.uuid || detail.info.rdns || detail.info.name);
    if(state.providers.some(item => (key && item.key === key) || item.provider === detail.provider)) return;
    state.providers.push({key,provider:detail.provider,info:detail.info || {name:'Browser wallet'}});
  }
  window.addEventListener('eip6963:announceProvider',announceProvider);
  function requestProviders(){ try{ window.dispatchEvent(new Event('eip6963:requestProvider')); }catch(error){} }
  function knownProviders(){
    requestProviders();
    if(state.providers.length) return state.providers;
    return window.ethereum ? [{key:'injected',provider:window.ethereum,info:{name:'Browser wallet'}}] : [];
  }
  function bindProvider(provider){
    if(state.wallet && state.wallet.removeListener && state._bound){
      state.wallet.removeListener('accountsChanged',state._bound.accounts);
      state.wallet.removeListener('chainChanged',state._bound.chain);
      state.wallet.removeListener('disconnect',state._bound.disconnect);
    }
    state.wallet = provider;
    state._bound = {
      accounts:accounts => { state.account=accounts && accounts[0] || null; syncWallet(); },
      chain:() => syncWallet(),
      disconnect:() => disconnectWallet()
    };
    if(provider.on){
      provider.on('accountsChanged',state._bound.accounts);
      provider.on('chainChanged',state._bound.chain);
      provider.on('disconnect',state._bound.disconnect);
    }
  }
  async function selectProvider(item){
    $('walletDialog').close();
    bindProvider(item.provider);
    try{
      const accounts = await state.wallet.request({method:'eth_requestAccounts'});
      state.account = accounts && accounts[0] || null;
      if(!state.account) throw new Error('Wallet returned no account');
      await ensureBase();
      await refreshPower();
      await refreshBallot({force:true});
      if(state.pendingWriteIn && canBrowseWriteIn()){
        state.pendingWriteIn=false;
        openWriteIn(true);
      }
    }catch(error){
      if(error && error.code !== 4001) toast(error.message || 'Wallet connection failed.',true);
      if(!state.account){ state.pendingWriteIn=false; disconnectWallet(); }
    }
  }
  function showWalletPicker(items){
    const list = $('walletList'); list.replaceChildren();
    items.forEach(item => {
      const button = document.createElement('button');
      button.className = 'vote-wallet-option'; button.type = 'button';
      if(item.info && item.info.icon){ const img=document.createElement('img'); img.src=item.info.icon; img.alt=''; button.appendChild(img); }
      const span=document.createElement('span'); span.textContent=(item.info && item.info.name) || 'Wallet'; button.appendChild(span);
      button.addEventListener('click',() => selectProvider(item)); list.appendChild(button);
    });
    $('walletDialog').showModal();
  }
  async function connectWallet(){
    if(state.account){ disconnectWallet(); return; }
    requestProviders(); await sleep(250);
    const items = knownProviders();
    if(!items.length){ state.pendingWriteIn=false; toast('No compatible wallet was detected. Open this page in Coinbase Wallet or install a browser wallet.',true); return; }
    if(items.length === 1) await selectProvider(items[0]); else showWalletPicker(items);
  }
  function disconnectWallet(){
    if(state.wallet && state.wallet.removeListener && state._bound){
      state.wallet.removeListener('accountsChanged',state._bound.accounts);
      state.wallet.removeListener('chainChanged',state._bound.chain);
      state.wallet.removeListener('disconnect',state._bound.disconnect);
    }
    state.wallet=null; state.account=null; state.onBase=false; state.power=0n; state.pendingWriteIn=false; state._bound=null;
    renderWallet(); renderSlots();
  }
  async function syncWallet(){
    if(!state.wallet) return;
    try{
      const accounts = await state.wallet.request({method:'eth_accounts'});
      state.account = accounts && accounts[0] || null;
      const chain = await state.wallet.request({method:'eth_chainId'});
      state.onBase = lower(chain) === BASE.idHex;
      await refreshPower();
      await refreshBallot({force:true});
    }catch(error){ disconnectWallet(); }
  }
  async function ensureBase(){
    if(!state.wallet) return false;
    let chain = await state.wallet.request({method:'eth_chainId'});
    if(lower(chain) === BASE.idHex){ state.onBase=true; renderWallet(); return true; }
    try{ await state.wallet.request({method:'wallet_switchEthereumChain',params:[{chainId:BASE.idHex}]}); }
    catch(error){
      if(error && (error.code===4902 || error.code===-32603)) await state.wallet.request({method:'wallet_addEthereumChain',params:[BASE.params]});
      else if(error && error.code===4001) return false;
      else throw error;
    }
    chain = await state.wallet.request({method:'eth_chainId'});
    state.onBase = lower(chain) === BASE.idHex;
    renderWallet();
    return state.onBase;
  }

  function encodeTransfer(to,units){
    return '0xa9059cbb' + lower(to).replace(/^0x/,'').padStart(64,'0') + BigInt(units).toString(16).padStart(64,'0');
  }
  function encodeApprove(spender,units){
    return '0x095ea7b3' + lower(spender).replace(/^0x/,'').padStart(64,'0') + BigInt(units).toString(16).padStart(64,'0');
  }
  async function waitReceipt(hash){
    for(let attempt=0;attempt<32;attempt++){
      const receipt = await rpc('eth_getTransactionReceipt',[hash]).catch(() => null);
      if(receipt && receipt.blockNumber) return receipt;
      await sleep(1200);
    }
    return null;
  }
  function receiptSucceeded(receipt){ return !receipt || receipt.status === undefined || receipt.status === '0x1' || receipt.status === 1 || receipt.status === true; }
  function receiptHasTransfer(receipt,from,to,amount){
    if(!receipt || !Array.isArray(receipt.logs)) return false;
    const wantedFrom = topicAddress(from);
    const wantedTo = topicAddress(to);
    return receipt.logs.some(log => lower(log.address)===lower(state.config.token) && lower(log.topics && log.topics[0])===TRANSFER_TOPIC && lower(log.topics && log.topics[1])===lower(wantedFrom) && lower(log.topics && log.topics[2])===lower(wantedTo) && BigInt(log.data || 0)===BigInt(amount));
  }
  function receiptHasApproval(receipt,owner,spender,amount){
    if(!receipt || !Array.isArray(receipt.logs)) return false;
    const wantedOwner = topicAddress(owner);
    const wantedSpender = topicAddress(spender);
    return receipt.logs.some(log => lower(log.address)===CANONICAL_TOKEN && lower(log.topics && log.topics[0])===APPROVAL_TOPIC && lower(log.topics && log.topics[1])===lower(wantedOwner) && lower(log.topics && log.topics[2])===lower(wantedSpender) && BigInt(log.data || 0)===BigInt(amount));
  }
  async function sendSignal(to,orgId,label){
    if(!state.wallet || !state.account) throw new Error('Connect a wallet first.');
    const account = state.account;
    if(!(await ensureBase())) throw new Error('Switch to Base to continue.');
    await refreshPower();
    if(lower(state.account)!==lower(account)) throw new Error('The connected wallet changed. Try again.');
    if(state.power <= 0n) throw new Error('This wallet holds no $BURGERS.');
    const amount = BigInt(state.config.round) * ENCODE_BASE + BigInt(orgId);
    if(state.power < amount) throw new Error('This wallet does not hold enough $BURGERS for the dust transfer.');
    const tx = {from:account,to:state.config.token,value:'0x0',data:encodeTransfer(to,amount)};
    try{ tx.gas = await state.wallet.request({method:'eth_estimateGas',params:[tx]}); }
    catch(error){ /* Let the wallet estimate when its standalone estimate endpoint is unavailable. */ }
    setStatus('Confirm the ' + label + ' transaction in your wallet…','');
    const hash = await state.wallet.request({method:'eth_sendTransaction',params:[tx]});
    if(!/^0x[0-9a-fA-F]{64}$/.test(String(hash || ''))) throw new Error('The wallet returned no transaction hash.');
    setStatus('Transaction sent. Waiting for Base confirmation…','');
    const receipt = await waitReceipt(hash);
    if(!receipt) throw new Error('The transaction is still pending. Refresh after it confirms.');
    if(!receiptSucceeded(receipt)) throw new Error('The transaction reverted on Base.');
    if(!receiptHasTransfer(receipt,account,to,amount)) throw new Error('No matching $BURGERS transfer was recorded.');
    return hash;
  }
  async function castVote(){
    const candidate = state.byId.get(state.selected);
    if(!candidate) return;
    $('castVote').disabled = true;
    try{
      await sendSignal(state.config.voteInbox,candidate.id,'vote');
      toast('Vote recorded on Base for ' + candidate.name + '.');
      await refreshBallot({force:true});
    }catch(error){
      if(error && error.code !== 4001){ setStatus(error.message || 'Vote failed.','error'); toast(error.message || 'Vote failed.',true); }
      else setStatus('Vote cancelled.','');
    }finally{ updateActions(); }
  }

  async function advanceRound(){
    if(!isDeveloper() || !state.wallet) return;
    const account = state.account;
    state.advancing=true; renderDevControls();
    try{
      if(!(await ensureBase())) throw new Error('Switch to Base to continue.');
      if(lower(state.account)!==lower(account)) throw new Error('The connected wallet changed. Try again.');
      const anchor = toNumber(await rpc('eth_blockNumber',[]));
      if(anchor >= Number(ROUND_BLOCK_BASE)) throw new Error('Base block is outside the round-control range.');
      const nextRound = state.config.round + 1;
      if(!Number.isSafeInteger(nextRound)) throw new Error('Invalid next round number.');
      const amount = BigInt(nextRound) * ROUND_BLOCK_BASE + BigInt(anchor);
      const tx = {from:account,to:CANONICAL_TOKEN,value:'0x0',data:encodeApprove(ROUND_CONTROL_SPENDER,amount)};
      try{ tx.gas = await state.wallet.request({method:'eth_estimateGas',params:[tx]}); }
      catch(error){ /* Let the wallet estimate during submission. */ }
      setStatus('Confirm the developer transaction to start a fresh ballot…','');
      const hash = await state.wallet.request({method:'eth_sendTransaction',params:[tx]});
      if(!/^0x[0-9a-fA-F]{64}$/.test(String(hash || ''))) throw new Error('The wallet returned no transaction hash.');
      setStatus('Ballot control transaction sent. Waiting for Base confirmation…','');
      const receipt = await waitReceipt(hash);
      if(!receipt) throw new Error('The transaction is still pending. Refresh after it confirms.');
      if(!receiptSucceeded(receipt)) throw new Error('The transaction reverted on Base.');
      if(!receiptHasApproval(receipt,account,ROUND_CONTROL_SPENDER,amount)) throw new Error('No matching developer round event was recorded.');
      toast('A fresh ballot is open with five empty seats.');
      state.selected=null; state.writeInChoice=null;
      await refreshBallot({force:true});
    }catch(error){
      if(error && error.code!==4001){ setStatus(error.message || 'Could not start a fresh ballot.','error'); toast(error.message || 'Could not start a fresh ballot.',true); }
      else setStatus('Fresh ballot cancelled.','');
    }finally{
      state.advancing=false; renderDevControls();
    }
  }

  function renderOrganizations(){
    const query = lower($('orgSearch').value).trim();
    const used = new Set(state.candidates.map(org => org.id));
    const matches = state.orgs.filter(org => !used.has(org.id) && (!query || lower(org.name+' '+org.country+' '+countryName(org.country)).includes(query)));
    $('orgResultsCount').textContent = matches.length + ' matching organization' + (matches.length===1?'':'s');
    const container = $('orgResults'); container.replaceChildren();
    matches.forEach(org => {
      const button = document.createElement('div');
      button.tabIndex=0; button.className='vote-org' + (state.writeInChoice===org.id?' is-selected':'');
      button.setAttribute('role','option'); button.setAttribute('aria-selected',String(state.writeInChoice===org.id));
      const logo=document.createElement('img'); logo.className='vote-org-logo'; logo.src=org.logo; logo.alt=''; logo.width=54; logo.height=54; logo.loading='lazy'; logo.decoding='async';
      logo.addEventListener('error',() => { logo.src='icon-192.png'; logo.classList.add('is-fallback'); },{once:true});
      const copy=document.createElement('span'); const strong=document.createElement('strong'); strong.textContent=org.name; const small=document.createElement('small'); small.textContent=countryName(org.country)+' · Official Hunger listing'; copy.append(strong,small);
      const source=document.createElement('a'); source.href=org.url; source.target='_blank'; source.rel='noopener'; source.textContent='View on The Giving Block ↗'; source.setAttribute('aria-label','View '+org.name+' on The Giving Block'); source.addEventListener('click',event => event.stopPropagation());
      button.append(logo,copy,source);
      const choose = () => {
        state.writeInChoice=org.id;
        $('writeInSelection').textContent=org.name;
        renderOrganizations();
        updateWriteInAction();
      };
      button.addEventListener('click',choose);
      button.addEventListener('keydown',event => { if(event.key==='Enter' || event.key===' '){ event.preventDefault(); choose(); } });
      container.appendChild(button);
    });
    if(!matches.length){ const empty=document.createElement('p'); empty.textContent='No matching organizations in the Giving Block Hunger list.'; container.appendChild(empty); }
  }
  function updateWriteInAction(){
    const button = $('submitWriteIn');
    const org = state.byId.get(state.writeInChoice);
    if(!org){ button.disabled=true; button.textContent='Select an organization'; return; }
    if(!state.account){ button.disabled=false; button.textContent='Connect wallet to nominate'; return; }
    if(!state.onBase){ button.disabled=false; button.textContent='Switch to Base to nominate'; return; }
    if(state.power<=0n){ button.disabled=true; button.textContent='Wallet needs $BURGERS'; return; }
    if(hasNominated()){ button.disabled=true; button.textContent='Write-in already submitted'; return; }
    button.disabled=false; button.textContent='Nominate ' + org.name;
  }
  function openWriteIn(preserve){
    if(!canBrowseWriteIn()) return;
    if(preserve!==true){
      state.writeInChoice=null;
      $('orgSearch').value='';
      $('writeInSelection').textContent='Select an organization to continue.';
    }
    $('writeInStatus').textContent=state.account ? '' : 'Browse freely. You will connect your wallet only when you confirm a nomination.';
    renderOrganizations(); updateWriteInAction();
    if(!$('writeInDialog').open) $('writeInDialog').showModal();
    setTimeout(() => $('orgSearch').focus(),80);
  }
  async function submitWriteIn(){
    const org=state.byId.get(state.writeInChoice);
    if(!org) return;
    if(!state.account){
      state.pendingWriteIn=true;
      $('writeInDialog').close();
      await connectWallet();
      return;
    }
    if(!state.onBase){
      await ensureBase();
      await refreshPower();
      updateWriteInAction();
      if(!state.onBase) return;
    }
    if(!canWriteIn()){
      $('writeInStatus').textContent=state.power<=0n ? 'This wallet must hold $BURGERS to nominate.' : 'This wallet is not eligible for another write-in on this ballot.';
      $('writeInStatus').className='vote-status is-error';
      return;
    }
    const button=$('submitWriteIn'); button.disabled=true;
    const status=$('writeInStatus'); status.textContent='Confirm the nomination in your wallet…'; status.className='vote-status';
    try{
      await sendSignal(state.config.writeInInbox,org.id,'write-in');
      status.textContent='Nomination confirmed on Base.'; status.className='vote-status is-ok';
      toast(org.name + ' filled an open ballot seat.');
      state.pendingWriteIn=false;
      await refreshBallot({force:true});
      setTimeout(() => $('writeInDialog').close(),700);
    }catch(error){
      if(error && error.code !== 4001){ status.textContent=error.message || 'Write-in failed.'; status.className='vote-status is-error'; }
      else status.textContent='Write-in cancelled.';
      button.disabled=false;
    }
  }

  function validateConfig(config){
    if(!config || !Number.isSafeInteger(config.round) || config.round<1) throw new Error('Invalid voting round');
    if(!Number.isSafeInteger(config.startBlock) || config.startBlock<1) throw new Error('Invalid round start block');
    if(config.slots!==5) throw new Error('Burger ballots must have five slots');
    ['token','controller','roundControlSpender','voteInbox','writeInInbox'].forEach(key => { if(!validAddress(config[key])) throw new Error('Invalid '+key); });
    if(config.chainId!==8453) throw new Error('Voting is only supported on Base');
    if(!['open','closed'].includes(config.status)) throw new Error('Invalid round status');
    if(config.roundBlockBase!==Number(ROUND_BLOCK_BASE) || lower(config.roundControlSpender)!==ROUND_CONTROL_SPENDER) throw new Error('Invalid developer round control');
    if(lower(config.token)!==CANONICAL_TOKEN || lower(config.controller)!==ROUND_CONTROLLER || lower(config.voteInbox)!==VOTE_INBOX || lower(config.writeInInbox)!==WRITE_IN_INBOX) throw new Error('Voting contracts do not match the Burger Money protocol');
    if(config.endBlock!==undefined && (!Number.isSafeInteger(config.endBlock) || config.endBlock<config.startBlock)) throw new Error('Invalid round end block');
  }
  function validateDirectory(payload){
    if(!payload || !Array.isArray(payload.organizations) || payload.organizations.length!==payload.count) throw new Error('Invalid organization directory');
    if(payload.organizations.length<1 || payload.organizations.length>=Number(ENCODE_BASE)) throw new Error('Organization directory is outside protocol limits');
    const seen=new Set();
    state.orgs=payload.organizations.map((item,index) => {
      if(!item || typeof item.name!=='string' || !/^[A-Z]{2}$/.test(item.country) || !/^https:\/\/thegivingblock\.com\/donate\/[a-z0-9-]+$/.test(item.url) || !/^charity-logos\/[a-z0-9-]+\.webp$/.test(item.logo)) throw new Error('Invalid organization entry');
      const slug=slugFromUrl(item.url); if(!slug || seen.has(slug)) throw new Error('Duplicate organization entry'); seen.add(slug);
      return {id:index+1,slug,name:item.name,country:item.country,url:item.url,logo:item.logo};
    });
    state.byId=new Map(state.orgs.map(org => [org.id,org]));
  }
  function formatMarketUsd(value){
    const number=Number(value);
    if(!Number.isFinite(number)) return '—';
    if(number>=1e6) return '$'+(number/1e6).toFixed(2)+'M';
    if(number>=1e3) return '$'+(number/1e3).toFixed(1)+'K';
    return '$'+number.toFixed(0);
  }
  async function loadHeaderMarket(){
    const change=$('tkChange');
    try{
      const response=await fetchDeadline('https://api.dexscreener.com/latest/dex/tokens/'+CANONICAL_TOKEN,{},10000);
      const data=await response.json();
      if(!data.pairs || !data.pairs.length) throw new Error('Market data unavailable');
      const pair=data.pairs.filter(item => item.chainId==='base').sort((a,b) => Number(b.liquidity && b.liquidity.usd || 0)-Number(a.liquidity && a.liquidity.usd || 0))[0] || data.pairs[0];
      $('tkPrice').textContent=formatMarketUsd(pair.marketCap || pair.fdv);
      const value=Number(pair.priceChange && pair.priceChange.h24);
      if(Number.isFinite(value)){
        change.textContent=(value>=0?'+':'')+value.toFixed(2)+'%';
        change.className='tk-change '+(value>=0?'up':'down');
      }else{ change.textContent='—'; change.className='tk-change'; }
    }catch(error){ change.textContent='live soon'; change.className='tk-change loading'; }
  }
  function bindSharedNav(){
    const nav=document.querySelector('header.nav');
    const toggle=$('navToggle');
    const panel=$('navButtons');
    function close(){ nav.classList.remove('open'); toggle.setAttribute('aria-expanded','false'); }
    toggle.addEventListener('click',event => { event.stopPropagation(); const opening=!nav.classList.contains('open'); close(); if(opening){ nav.classList.add('open'); toggle.setAttribute('aria-expanded','true'); } });
    document.addEventListener('click',event => { if(nav.classList.contains('open') && !panel.contains(event.target) && !toggle.contains(event.target)) close(); });
    document.addEventListener('keydown',event => { if(event.key==='Escape') close(); });
    panel.querySelectorAll('a').forEach(link => link.addEventListener('click',close));
    window.addEventListener('resize',() => { if(window.innerWidth>1180) close(); });
  }
  function bindUI(){
    bindSharedNav();
    $('connectWallet').addEventListener('click',connectWallet);
    $('refreshBallot').addEventListener('click',() => refreshBallot({force:true}));
    $('castVote').addEventListener('click',castVote);
    $('advanceRound').addEventListener('click',advanceRound);
    $('openWriteIn').addEventListener('click',openWriteIn);
    $('submitWriteIn').addEventListener('click',submitWriteIn);
    $('orgSearch').addEventListener('input',renderOrganizations);
    document.querySelectorAll('.vote-dialog-close').forEach(button => button.addEventListener('click',() => button.closest('dialog').close()));
    $('writeInDialog').addEventListener('submit',event => event.preventDefault());
    $('walletDialog').addEventListener('submit',event => event.preventDefault());
  }
  async function tryResume(){
    requestProviders(); await sleep(180);
    const providers=knownProviders();
    for(const item of providers){
      try{
        const accounts=await item.provider.request({method:'eth_accounts'});
        if(accounts && accounts[0]){ bindProvider(item.provider); state.account=accounts[0]; await syncWallet(); return; }
      }catch(error){}
    }
  }
  async function boot(){
    bindUI(); requestProviders(); loadHeaderMarket(); setInterval(loadHeaderMarket,45000);
    try{
      const responses=await Promise.all([
        fetch('vote-config.json?v=20260818c',{cache:'no-store'}),
        fetch('vote-organizations.json?v=20260818c',{cache:'no-store'})
      ]);
      if(!responses[0].ok || !responses[1].ok) throw new Error('Voting data unavailable');
      const config=await responses[0].json(); const directory=await responses[1].json();
      validateConfig(config); validateDirectory(directory); state.baseConfig=config; state.config=Object.assign({},config);
      state.totalWeight=0n;
      $('connectWallet').disabled=false;
      $('roundState').textContent=config.status==='open'?'Open':'Closed'; $('directoryCount').textContent=state.orgs.length; $('heroDirectoryCount').textContent=state.orgs.length; $('writeInDirectoryCount').textContent=state.orgs.length;
      renderWallet();
      await Promise.all([refreshBallot({force:true}),tryResume()]);
    }catch(error){
      setStatus('The ballot configuration could not be verified. Voting is disabled until the published data is corrected.','error');
      $('roundState').textContent='Unavailable';
      toast(error.message || 'Voting unavailable.',true);
    }
  }

  document.addEventListener('DOMContentLoaded',boot,{once:true});
})();
