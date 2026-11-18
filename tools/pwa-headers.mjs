// Cloudflare static _headers: all matching rules combine; splats and named placeholders expand.
const escape = s => s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
export function parseHeaders(text) {
  const rules=[];let rule;
  for(const raw of text.split(/\r?\n/)) {
    const line=raw.trim();if(!line || line.startsWith('#')) continue;
    if(!/^\s/.test(raw)) {
      const names=[];let pattern='',i=0;
      while(i<line.length) {
        if(line[i]==='*') {names.push('splat');pattern+='(.*)';i++;}
        else if(line[i]===':' && /[A-Za-z]/.test(line[i+1]||'')) {
          const name=/^:([A-Za-z]\w*)/.exec(line.slice(i))[1];names.push(name);
          const inHost=line.startsWith('https://') && i<line.indexOf('/',8);
          pattern+=inHost?'([^./]+)':'([^/]+)';i+=name.length+1;
        } else {pattern+=escape(line[i++]);}
      }
      rule={pattern:new RegExp('^'+pattern+'$'),absolute:line.startsWith('https://'),names,headers:[]};rules.push(rule);
    } else {
      if(!rule) throw Error('Header without a URL rule');
      if(line.startsWith('! ')) rule.headers.push({remove:line.slice(2).trim()});
      else {const n=line.indexOf(':');if(n<1) throw Error('Invalid header');rule.headers.push({name:line.slice(0,n),value:line.slice(n+1).trim()});}
    }
  }
  return rules;
}
export function headersFor(rules,input,base={}) {
  const url=new URL(input),out=new Headers(base),added=new Headers();
  for(const r of rules) {
    const m=r.pattern.exec(r.absolute?url.origin+url.pathname:url.pathname);if(!m) continue;
    const values=Object.fromEntries(r.names.map((name,i)=>[name,m[i+1]]));
    for(const h of r.headers) {
      if(h.remove) {added.delete(h.remove);out.delete(h.remove);}
      else added.append(h.name,h.value.replace(/:([A-Za-z]\w*)/g,(all,name)=>values[name]??all));
    }
  }
  for(const [name,value] of added) out.set(name,value);
  return out;
}
