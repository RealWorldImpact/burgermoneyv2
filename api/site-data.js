'use strict';

const TOKEN = '0x06A05043eb2C1691b19c2C13219dB9212269dDc5';
const TOKEN_LOWER = TOKEN.toLowerCase();
const DEX_PRIMARY = 'https://api.dexscreener.com/tokens/v1/base/' + TOKEN;
const DEX_LEGACY = 'https://api.dexscreener.com/latest/dex/tokens/' + TOKEN;
const GECKO_POOLS = 'https://api.geckoterminal.com/api/v2/networks/base/tokens/' + TOKEN + '/pools?page=1';
const UPSTREAM_TIMEOUT_MS = 6500;
const MEMORY_STALE_MS = 6 * 60 * 60 * 1000;

let lastGood = null;
let lastGoodAt = 0;

function finite(value){
  if(value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function cleanPair(pair){
  if(!pair || pair.chainId !== 'base') return null;
  const base = String(pair.baseToken && pair.baseToken.address || '').toLowerCase();
  if(base !== TOKEN_LOWER) return null;
  const priceUsd = finite(pair.priceUsd);
  const marketCap = finite(pair.marketCap) || finite(pair.fdv);
  const liquidity = finite(pair.liquidity && pair.liquidity.usd);
  const volume = finite(pair.volume && pair.volume.h24);
  const change = finite(pair.priceChange && pair.priceChange.h24);
  if(!(priceUsd > 0) || !(marketCap > 0) || liquidity === null || volume === null || change === null) return null;
  return {
    chainId: 'base',
    dexId: String(pair.dexId || 'unknown'),
    pairAddress: String(pair.pairAddress || ''),
    baseToken: pair.baseToken || {address:TOKEN,name:'Burger Money',symbol:'BURGERS'},
    quoteToken: pair.quoteToken || {},
    priceUsd: String(priceUsd),
    marketCap,
    fdv: finite(pair.fdv) || marketCap,
    liquidity: {usd: liquidity},
    volume: {h24: volume},
    priceChange: {h24: change}
  };
}

function cleanGeckoPool(item){
  const attributes = item && item.attributes;
  if(!attributes) return null;
  const baseId = String(item.relationships && item.relationships.base_token && item.relationships.base_token.data && item.relationships.base_token.data.id || '').toLowerCase();
  if(baseId && !baseId.endsWith('_' + TOKEN_LOWER)) return null;
  const priceUsd = finite(attributes.base_token_price_usd || attributes.token_price_usd);
  const marketCap = finite(attributes.market_cap_usd) || finite(attributes.fdv_usd);
  const liquidity = finite(attributes.reserve_in_usd);
  const volume = finite(attributes.volume_usd && attributes.volume_usd.h24);
  const change = finite(attributes.price_change_percentage && attributes.price_change_percentage.h24);
  if(!(priceUsd > 0) || !(marketCap > 0) || liquidity === null || volume === null || change === null) return null;
  return {
    chainId: 'base',
    dexId: 'geckoterminal',
    pairAddress: String(attributes.address || ''),
    baseToken: {address:TOKEN,name:'Burger Money',symbol:'BURGERS'},
    quoteToken: {},
    priceUsd: String(priceUsd),
    marketCap,
    fdv: finite(attributes.fdv_usd) || marketCap,
    liquidity: {usd: liquidity},
    volume: {h24: volume},
    priceChange: {h24: change}
  };
}

async function fetchJson(url,headers){
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(),UPSTREAM_TIMEOUT_MS);
  try{
    const response = await fetch(url,{headers:Object.assign({'User-Agent':'BurgerMoney.org market status'},headers),signal:controller.signal});
    if(!response.ok) throw new Error('Upstream returned ' + response.status);
    return await response.json();
  }finally{
    clearTimeout(timer);
  }
}

async function fromDexScreener(){
  let payload;
  try{
    payload = await fetchJson(DEX_PRIMARY,{Accept:'application/json'});
  }catch(error){
    payload = await fetchJson(DEX_LEGACY,{Accept:'application/json'});
  }
  const rawPairs = Array.isArray(payload) ? payload : payload && payload.pairs;
  const pairs = Array.isArray(rawPairs) ? rawPairs.map(cleanPair).filter(Boolean) : [];
  if(!pairs.length) throw new Error('DEX Screener returned no complete Base pair');
  return {pairs,source:'dexscreener',updatedAt:new Date().toISOString()};
}

async function fromGeckoTerminal(){
  const payload = await fetchJson(GECKO_POOLS,{Accept:'application/json;version=20230302'});
  const pairs = Array.isArray(payload && payload.data) ? payload.data.map(cleanGeckoPool).filter(Boolean) : [];
  if(!pairs.length) throw new Error('GeckoTerminal returned no complete Base pool');
  return {pairs,source:'geckoterminal',updatedAt:new Date().toISOString()};
}

module.exports = async function market(req,res){
  if(req.method !== 'GET' && req.method !== 'HEAD'){
    res.setHeader('Allow','GET, HEAD');
    return res.status(405).json({error:'Method not allowed'});
  }
  res.setHeader('Content-Type','application/json; charset=utf-8');
  res.setHeader('Cache-Control','public, max-age=0, s-maxage=45, stale-while-revalidate=900');
  try{
    const payload = await Promise.any([fromDexScreener(),fromGeckoTerminal()]);
    lastGood = payload;
    lastGoodAt = Date.now();
    res.setHeader('X-Market-Source',payload.source);
    if(req.method === 'HEAD') return res.status(200).end();
    return res.status(200).json(payload);
  }catch(error){
    if(lastGood && Date.now() - lastGoodAt < MEMORY_STALE_MS){
      const stale = Object.assign({},lastGood,{stale:true});
      res.setHeader('X-Market-Source',lastGood.source + '-stale');
      if(req.method === 'HEAD') return res.status(200).end();
      return res.status(200).json(stale);
    }
    res.setHeader('Cache-Control','no-store');
    if(req.method === 'HEAD') return res.status(503).end();
    return res.status(503).json({error:'Market data is temporarily unavailable'});
  }
};
