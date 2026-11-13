/* Roda dentro da pagina do SharePoint (via CDP) para usar a sessao do usuario.
   Sem dependencias; devolve sempre uma string JSON. */
window.__SP = (function () {
  var HDR = { 'Accept': 'application/json;odata=nometadata' };

  function encodePath(p) {
    return p.split('/').map(encodeURIComponent).join('/');
  }

  function isHtml(text) {
    var head = (text || '').slice(0, 400).toLowerCase();
    return head.indexOf('<!doctype html') >= 0 || head.indexOf('<html') >= 0;
  }

  async function readJson(url) {
    var res = await fetch(url, { headers: HDR, credentials: 'include' });
    var text = await res.text();
    if (!res.ok) { return { ok: false, status: res.status, text: text }; }
    if (isHtml(text)) { return { ok: false, status: 401, text: text, login: true }; }
    try { return { ok: true, status: res.status, json: JSON.parse(text), text: text }; }
    catch (e) { return { ok: false, status: res.status, text: text, error: 'json invalido' }; }
  }

  /* Sem sessao o SharePoint responde 200 com value vazio em algumas rotas,
     entao a checagem e pelo usuario atual: anonimo nao tem LoginName. */
  async function auth(site) {
    var r = await readJson(site + '/_api/web/currentuser?$select=LoginName,Title');
    if (!r.ok) { return { ok: false, status: r.status, login: !!r.login }; }
    var user = r.json && (r.json.LoginName || (r.json.d && r.json.d.LoginName));
    if (!user) { return { ok: false, status: 401, login: true }; }
    return { ok: true, user: user };
  }

  /* Lista as pastas informadas (caminho relativo a biblioteca) e devolve os
     ultimos arquivos .xlsx de cada uma, do mais recente para o mais antigo. */
  async function list(site, rels) {
    var out = { ok: true, auth: true, folders: {}, errors: [] };
    var a = await auth(site);
    if (!a.ok) { return { ok: false, auth: false, status: a.status, login: !!a.login, user: '' }; }
    out.user = a.user;

    var libsRes = await readJson(site + '/_api/web/lists?$filter=BaseTemplate eq 101' +
      '&$select=Title,RootFolder/ServerRelativeUrl&$expand=RootFolder');
    if (!libsRes.ok) { return { ok: false, auth: true, status: libsRes.status, error: 'bibliotecas' }; }
    var libs = (libsRes.json.value || []).map(function (l) {
      return l.RootFolder && l.RootFolder.ServerRelativeUrl;
    }).filter(Boolean);

    for (var i = 0; i < rels.length; i++) {
      var rel = rels[i];
      var found = null;
      for (var j = 0; j < libs.length && !found; j++) {
        var cand = libs[j].replace(/\/+$/, '') + '/' + rel;
        var url = site + "/_api/web/GetFolderByServerRelativePath(decodedurl='" + encodePath(cand) + "')" +
          '/Files?$select=Name,TimeLastModified,ServerRelativeUrl,Length&$orderby=TimeLastModified desc&$top=10';
        var r = await readJson(url);
        if (r.ok) { found = { folder: cand, files: r.json.value || [], sample: (r.text || '').slice(0, 260) }; }
      }
      if (found) {
        out.folders[rel] = {
          folder: found.folder,
          sample: found.sample,
          files: found.files.filter(function (f) { return /\.xlsx?$/i.test(f.Name); })
            .map(function (f) {
              return {
                name: f.Name,
                modified: f.TimeLastModified,
                path: f.ServerRelativeUrl,
                size: f.Length
              };
            })
        };
      } else {
        out.folders[rel] = { folder: '', files: [] };
        out.errors.push(rel);
      }
    }
    return out;
  }

  /* Lista as subpastas de um caminho relativo a biblioteca (usado para achar
     a pasta do mes corrente, cujo nome varia entre as bibliotecas). */
  async function folders(site, rel) {
    var a = await auth(site);
    if (!a.ok) { return { ok: false, auth: false, status: a.status, names: [] }; }
    var libsRes = await readJson(site + '/_api/web/lists?$filter=BaseTemplate eq 101' +
      '&$select=Title,RootFolder/ServerRelativeUrl&$expand=RootFolder');
    if (!libsRes.ok) { return { ok: false, auth: true, status: libsRes.status, names: [] }; }
    var libs = (libsRes.json.value || []).map(function (l) {
      return l.RootFolder && l.RootFolder.ServerRelativeUrl;
    }).filter(Boolean);
    for (var j = 0; j < libs.length; j++) {
      var cand = libs[j].replace(/\/+$/, '') + '/' + rel;
      var r = await readJson(site + "/_api/web/GetFolderByServerRelativePath(decodedurl='" +
        encodePath(cand) + "')/Folders?$select=Name");
      if (r.ok) {
        return {
          ok: true,
          auth: true,
          path: cand,
          names: (r.json.value || []).map(function (f) { return f.Name; })
        };
      }
    }
    return { ok: false, auth: true, status: 404, names: [] };
  }

  /* Baixa um arquivo da biblioteca e devolve base64 (para gravar no disco). */
  async function download(site, filePath) {
    var url = site + "/_api/web/GetFileByServerRelativePath(decodedurl='" + encodePath(filePath) + "')/$value";
    var res = await fetch(url, { credentials: 'include' });
    if (!res.ok) { return { ok: false, status: res.status, file: filePath }; }
    var buf = new Uint8Array(await res.arrayBuffer());
    if (buf.length > 2 && buf[0] === 0x3C) { return { ok: false, status: 401, login: true, file: filePath }; }
    var parts = [], chunk = 0x8000;
    for (var i = 0; i < buf.length; i += chunk) {
      parts.push(String.fromCharCode.apply(null, buf.subarray(i, i + chunk)));
    }
    return { ok: true, size: buf.length, b64: btoa(parts.join('')), file: filePath };
  }

  return { list: list, download: download, folders: folders, auth: auth };
})();
