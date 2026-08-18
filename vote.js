(function(){
  'use strict';

  const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
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

  const state = {
    config:null,
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
    selected:null,
    writeInChoice:null,
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
    const ballotReady = nominations.length === state.config.slots;
    const ballotOpenedAt = ballotReady ? nominations[nominations.length-1] : null;
    const candidateIds = new Set(ballotReady ? nominations.map(row => row.orgId) : []);
    const latestVote = new Map();
    for(const row of logs.votes){
      if(candidateIds.has(row.orgId) && compareLogs(row,ballotOpenedAt)>0) latestVote.set(row.address,row);
    }
    const totals = new Map(nominations.map(row => [row.orgId,0n]));
    const votes = [];
    latestVote.forEach((row,address) => {
      const weight = balances.get(address) || 0n;
      if(weight <= 0n) return;
      totals.set(row.orgId,(totals.get(row.orgId) || 0n) + weight);
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
        article.innerHTML = '<span class="vote-slot-index">' + (index+1) + '</span><div class="vote-slot-copy"><strong>Open community seat</strong><span>Waiting for a $BURGERS holder write-in</span></div><div class="vote-result"><div class="vote-result-bar"><span style="width:0"></span></div><strong>—</strong><small>No nominee yet</small></div>';
        if(canWriteIn()){
          article.tabIndex = 0;
          article.setAttribute('role','button');
          article.setAttribute('aria-label','Fill open seat ' + (index+1));
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
      article.innerHTML = '<span class="vote-slot-index">' + (index+1) + '</span>' +
        '<div class="vote-slot-copy"><strong></strong><span><b></b><a target="_blank" rel="noopener">Giving Block ↗</a></span></div>' +
        '<div class="vote-result"><div class="vote-result-bar"><span></span></div><strong></strong><small></small></div>';
      article.querySelector('.vote-slot-copy strong').textContent = candidate.name;
      article.querySelector('.vote-slot-copy b').textContent = candidate.country;
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
  function renderRound(){
    $('roundNumber').textContent = state.config.round;
    $('roundState').textContent = state.config.status === 'open' ? 'Open' : 'Closed';
    $('directoryCount').textContent = state.orgs.length;
    $('heroDirectoryCount').textContent = state.orgs.length;
    const voters = state.votes.length;
    const seats = state.candidates.length;
    $('roundSummary').textContent = seats + ' of ' + state.config.slots + ' seats filled · ' + voters + ' voting wallet' + (voters===1?'':'s') + ' · ' + formatToken(state.totalWeight) + ' $BURGERS signaling';
    if(state.config.status !== 'open') setStatus('This round is closed. Results remain visible.','');
    else if(!seats) setStatus('All five seats are open. Connect a wallet holding $BURGERS to nominate the first organization.','');
    else if(seats < state.config.slots) setStatus((state.config.slots-seats) + ' open seat' + (state.config.slots-seats===1?' remains':'s remain') + '. Fill the ballot to open voting.','');
    else setStatus('All five seats are filled. The ballot is live.','ok');
    renderSlots();
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
    updateActions();
  }
  function hasNominated(){ return !!state.account && state.nominations.some(row => row.address === lower(state.account)); }
  function canWriteIn(){
    return !!state.config && state.config.status === 'open' && !!state.account && state.onBase && state.power > 0n && state.candidates.length < state.config.slots && !hasNominated();
  }
  function updateActions(){
    const cast = $('castVote');
    const write = $('openWriteIn');
    const open = state.config && state.config.status === 'open';
    const ballotReady = !!state.config && state.candidates.length === state.config.slots;
    cast.disabled = !(open && ballotReady && state.account && state.onBase && state.power > 0n && state.selected && state.candidates.some(org => org.id === state.selected));
    if(!ballotReady) cast.textContent = 'Voting opens after five write-ins';
    else if(!state.selected) cast.textContent = 'Choose a charity to vote';
    else if(!state.account) cast.textContent = 'Connect wallet to vote';
    else if(!state.onBase) cast.textContent = 'Switch to Base to vote';
    else if(state.power <= 0n) cast.textContent = 'No $BURGERS voting power';
    else cast.textContent = 'Cast ' + formatToken(state.power) + ' $BURGERS vote';
    write.disabled = !canWriteIn();
    if(state.candidates.length >= (state.config ? state.config.slots : 5)) write.textContent = 'All five seats filled';
    else if(hasNominated()) write.textContent = 'Write-in already submitted';
    else write.textContent = 'Fill an open seat';
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
    setStatus('Reading this round’s $BURGERS signals from Base…','');
    try{
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
    }catch(error){
      if(seq !== state.refreshSeq) return;
      setStatus('The Base RPC could not finish the tally. No partial result is being shown; try Refresh results.','error');
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
    }catch(error){
      if(error && error.code !== 4001) toast(error.message || 'Wallet connection failed.',true);
      if(!state.account) disconnectWallet();
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
    if(!items.length){ toast('No compatible wallet was detected. Open this page in Coinbase Wallet or install a browser wallet.',true); return; }
    if(items.length === 1) await selectProvider(items[0]); else showWalletPicker(items);
  }
  function disconnectWallet(){
    if(state.wallet && state.wallet.removeListener && state._bound){
      state.wallet.removeListener('accountsChanged',state._bound.accounts);
      state.wallet.removeListener('chainChanged',state._bound.chain);
      state.wallet.removeListener('disconnect',state._bound.disconnect);
    }
    state.wallet=null; state.account=null; state.onBase=false; state.power=0n; state._bound=null;
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
      const flag=document.createElement('span'); flag.className='vote-org-flag'; flag.textContent=org.country;
      const copy=document.createElement('span'); const strong=document.createElement('strong'); strong.textContent=org.name; const small=document.createElement('small'); small.textContent='Giving Block Hunger directory'; copy.append(strong,small);
      const source=document.createElement('a'); source.href=org.url; source.target='_blank'; source.rel='noopener'; source.textContent='View ↗'; source.addEventListener('click',event => event.stopPropagation());
      button.append(flag,copy,source);
      const choose = () => {
        state.writeInChoice=org.id;
        $('writeInSelection').textContent=org.name;
        $('submitWriteIn').disabled=false;
        renderOrganizations();
      };
      button.addEventListener('click',choose);
      button.addEventListener('keydown',event => { if(event.key==='Enter' || event.key===' '){ event.preventDefault(); choose(); } });
      container.appendChild(button);
    });
    if(!matches.length){ const empty=document.createElement('p'); empty.textContent='No matching organizations in the Giving Block Hunger list.'; container.appendChild(empty); }
  }
  function openWriteIn(){
    if(!canWriteIn()) return;
    state.writeInChoice=null;
    $('orgSearch').value=''; $('writeInSelection').textContent='Select an organization to continue.'; $('submitWriteIn').disabled=true; $('writeInStatus').textContent='';
    renderOrganizations(); $('writeInDialog').showModal(); setTimeout(() => $('orgSearch').focus(),80);
  }
  async function submitWriteIn(){
    const org=state.byId.get(state.writeInChoice);
    if(!org || !canWriteIn()) return;
    const button=$('submitWriteIn'); button.disabled=true;
    const status=$('writeInStatus'); status.textContent='Confirm the nomination in your wallet…'; status.className='vote-status';
    try{
      await sendSignal(state.config.writeInInbox,org.id,'write-in');
      status.textContent='Nomination confirmed on Base.'; status.className='vote-status is-ok';
      toast(org.name + ' filled an open ballot seat.');
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
    ['token','controller','voteInbox','writeInInbox'].forEach(key => { if(!validAddress(config[key])) throw new Error('Invalid '+key); });
    if(config.chainId!==8453) throw new Error('Voting is only supported on Base');
    if(!['open','closed'].includes(config.status)) throw new Error('Invalid round status');
    if(lower(config.token)!==CANONICAL_TOKEN || lower(config.controller)!==ROUND_CONTROLLER || lower(config.voteInbox)!==VOTE_INBOX || lower(config.writeInInbox)!==WRITE_IN_INBOX) throw new Error('Voting contracts do not match the Burger Money protocol');
    if(config.endBlock!==undefined && (!Number.isSafeInteger(config.endBlock) || config.endBlock<config.startBlock)) throw new Error('Invalid round end block');
  }
  function validateDirectory(payload){
    if(!payload || !Array.isArray(payload.organizations) || payload.organizations.length!==payload.count) throw new Error('Invalid organization directory');
    if(payload.organizations.length<1 || payload.organizations.length>=Number(ENCODE_BASE)) throw new Error('Organization directory is outside protocol limits');
    const seen=new Set();
    state.orgs=payload.organizations.map((item,index) => {
      if(!item || typeof item.name!=='string' || !/^[A-Z]{2}$/.test(item.country) || !/^https:\/\/thegivingblock\.com\/donate\/[a-z0-9-]+$/.test(item.url)) throw new Error('Invalid organization entry');
      const slug=slugFromUrl(item.url); if(!slug || seen.has(slug)) throw new Error('Duplicate organization entry'); seen.add(slug);
      return {id:index+1,slug,name:item.name,country:item.country,url:item.url};
    });
    state.byId=new Map(state.orgs.map(org => [org.id,org]));
  }
  function bindUI(){
    $('voteMenu').addEventListener('click',() => {
      const nav=document.querySelector('.vote-nav'); const open=nav.classList.toggle('is-open'); $('voteMenu').setAttribute('aria-expanded',String(open));
    });
    $('voteNavLinks').querySelectorAll('a').forEach(link => link.addEventListener('click',() => { document.querySelector('.vote-nav').classList.remove('is-open'); $('voteMenu').setAttribute('aria-expanded','false'); }));
    $('connectWallet').addEventListener('click',connectWallet);
    $('refreshBallot').addEventListener('click',() => refreshBallot({force:true}));
    $('castVote').addEventListener('click',castVote);
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
    bindUI(); requestProviders();
    try{
      const responses=await Promise.all([
        fetch('vote-config.json?v=20260818a',{cache:'no-store'}),
        fetch('vote-organizations.json?v=20260818a',{cache:'no-store'})
      ]);
      if(!responses[0].ok || !responses[1].ok) throw new Error('Voting data unavailable');
      const config=await responses[0].json(); const directory=await responses[1].json();
      validateConfig(config); validateDirectory(directory); state.config=config;
      state.totalWeight=0n;
      $('connectWallet').disabled=false;
      $('roundNumber').textContent=config.round; $('roundState').textContent=config.status==='open'?'Open':'Closed'; $('directoryCount').textContent=state.orgs.length; $('heroDirectoryCount').textContent=state.orgs.length;
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
