'use strict';

/* =====================================================
   超輕量的 Supabase 連線程式（不需要任何外部套件）
   只用瀏覽器內建的 fetch，所以連舊版 Safari（例如 iPad mini 2 的 iOS 12）也能跑。
   提供 app.js 用到的寫法：from().select/insert/update/delete/eq/order/single、rpc()、auth
   只用公開的 Publishable key；登入後會改用使用者自己的登入憑證。
   ===================================================== */
(function () {
  var STORE = 'fridge-auth-session';

  function createLiteClient(url, key) {
    var session = readSession();

    function readSession() {
      try { return JSON.parse(localStorage.getItem(STORE)); } catch (e) { return null; }
    }
    function writeSession(s) {
      session = s;
      try {
        if (s) localStorage.setItem(STORE, JSON.stringify(s));
        else localStorage.removeItem(STORE);
      } catch (e) { /* 無痕模式存不了就算了，只是重新整理後要重新登入 */ }
    }
    function nowSec() { return Math.floor(Date.now() / 1000); }
    function toSession(d) {
      return {
        access_token: d.access_token,
        refresh_token: d.refresh_token,
        expires_at: nowSec() + (d.expires_in || 3600),
        user: d.user || null,
      };
    }

    // 送出請求。永遠回傳 { data, error }，不會丟出例外
    function send(method, path, opts) {
      opts = opts || {};
      var headers = Object.assign({ apikey: key, 'Content-Type': 'application/json' }, opts.headers || {});
      if (opts.token) headers.Authorization = 'Bearer ' + opts.token;
      return fetch(url + path, {
        method: method,
        headers: headers,
        body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
      }).then(function (res) {
        return res.text().then(function (text) {
          var data = null;
          try { data = text ? JSON.parse(text) : null; } catch (e) { data = null; }
          if (!res.ok) {
            var msg = (data && (data.message || data.error_description || data.msg || data.error)) || res.statusText || ('HTTP ' + res.status);
            return { data: null, error: { message: msg, status: res.status } };
          }
          return { data: data, error: null };
        });
      }).catch(function (err) {
        return { data: null, error: { message: '網路連線失敗：' + (err && err.message ? err.message : err) } };
      });
    }

    // 取得有效的登入憑證，快過期就先換新的
    function validToken() {
      if (!session) return Promise.resolve(null);
      if (session.expires_at - 60 > nowSec()) return Promise.resolve(session.access_token);
      return send('POST', '/auth/v1/token?grant_type=refresh_token', { body: { refresh_token: session.refresh_token } })
        .then(function (r) {
          if (r.error || !r.data || !r.data.access_token) { writeSession(null); return null; }
          writeSession(toSession(r.data));
          return session.access_token;
        });
    }

    function authed(method, path, opts) {
      return validToken().then(function (token) {
        opts = Object.assign({}, opts || {});
        opts.token = token;
        return send(method, path, opts);
      });
    }

    /* ----- 資料表查詢（寫法與 supabase-js 相同） ----- */
    function Query(table) {
      this.table = table;
      this.method = 'GET';
      this.params = [];
      this.body = undefined;
      this.returnRows = false;
      this.wantOne = false;
    }
    Query.prototype.select = function (cols) {
      this.params.push('select=' + encodeURIComponent(cols || '*'));
      if (this.method !== 'GET') this.returnRows = true;
      return this;
    };
    Query.prototype.insert = function (row) { this.method = 'POST'; this.body = row; return this; };
    Query.prototype.update = function (patch) { this.method = 'PATCH'; this.body = patch; return this; };
    Query.prototype.delete = function () { this.method = 'DELETE'; return this; };
    Query.prototype.eq = function (col, val) {
      this.params.push(encodeURIComponent(col) + '=eq.' + encodeURIComponent(val));
      return this;
    };
    Query.prototype.order = function (col, o) {
      this.params.push('order=' + encodeURIComponent(col) + '.' + (o && o.ascending === false ? 'desc' : 'asc'));
      return this;
    };
    Query.prototype.single = function () { this.wantOne = true; return this; };
    Query.prototype.exec = function () {
      var headers = {};
      if (this.returnRows) headers.Prefer = 'return=representation';
      if (this.wantOne) headers.Accept = 'application/vnd.pgrst.object+json';
      var qs = this.params.length ? '?' + this.params.join('&') : '';
      return authed(this.method, '/rest/v1/' + this.table + qs, { body: this.body, headers: headers });
    };
    Query.prototype.then = function (ok, fail) { return this.exec().then(ok, fail); };

    /* ----- 登入 ----- */
    var auth = {
      getSession: function () {
        return validToken().then(function (token) {
          return { data: { session: token ? session : null } };
        });
      },
      signInWithPassword: function (cred) {
        return send('POST', '/auth/v1/token?grant_type=password', { body: { email: cred.email, password: cred.password } })
          .then(function (r) {
            if (r.error || !r.data || !r.data.access_token) {
              return { data: null, error: r.error || { message: '登入失敗' } };
            }
            writeSession(toSession(r.data));
            return { data: { session: session }, error: null };
          });
      },
      signOut: function () {
        var token = session && session.access_token;
        writeSession(null);
        if (!token) return Promise.resolve({ error: null });
        return send('POST', '/auth/v1/logout', { token: token }).then(function () { return { error: null }; });
      },
    };

    return {
      from: function (table) { return new Query(table); },
      rpc: function (name, args) { return authed('POST', '/rest/v1/rpc/' + name, { body: args || {} }); },
      auth: auth,
    };
  }

  window.createLiteClient = createLiteClient;
})();
