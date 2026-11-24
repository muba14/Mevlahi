(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const audio = $('audio');
  const store = {
    get(k, d) { try { const v = localStorage.getItem('mevlahi.' + k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem('mevlahi.' + k, JSON.stringify(v)); } catch (e) { /* yok say */ } }
  };

  const SIZES = [{ s: 1, l: 'Normal' }, { s: 1.18, l: 'Büyük' }, { s: 1.36, l: 'Çok büyük' }];

  let tracks = [];          // {file, src, title, artist}
  let favs = new Set(store.get('favs', []));
  let tab = 'all';
  let query = '';
  let current = -1;         // tracks dizisindeki index
  let repeatOne = store.get('repeat', false);
  let sizeIdx = store.get('size', 0);
  let seeking = false;

  /* ---------- Yardımcılar ---------- */
  const norm = (s) => s.toLocaleLowerCase('tr')
    .replace(/ı/g, 'i').replace(/ğ/g, 'g').replace(/ü/g, 'u').replace(/ş/g, 's').replace(/ö/g, 'o').replace(/ç/g, 'c')
    .replace(/[âà]/g, 'a').replace(/[îì]/g, 'i').replace(/[ûù]/g, 'u');

  const fmt = (t) => {
    if (!isFinite(t) || t < 0) t = 0;
    const m = Math.floor(t / 60), s = Math.floor(t % 60);
    return m + ':' + (s < 10 ? '0' : '') + s;
  };

  function parseName(file) {
    let base = file.replace(/\.[^.]+$/, '').replace(/[_]+/g, ' ').trim();
    base = base.replace(/^\d+\s*[-.)_]?\s*/, '');           // "01 - " gibi sıra numaralarını at
    const parts = base.split(/\s+-\s+/);
    if (parts.length >= 2) return { artist: parts[0].trim(), title: parts.slice(1).join(' - ').trim() };
    return { artist: '', title: base };
  }

  function toast(msg) {
    const t = $('toast');
    t.textContent = msg; t.hidden = false;
    clearTimeout(toast._h); toast._h = setTimeout(() => { t.hidden = true; }, 2200);
  }

  /* ---------- Veri yükleme ---------- */
  async function loadTracks() {
    let files = [], names = {};
    if (window.Android && typeof Android.listAudio === 'function') {
      try { files = JSON.parse(Android.listAudio()); } catch (e) { files = []; }
      try { const t = Android.readText('www/audio/ilahiler.json'); if (t) names = JSON.parse(t); } catch (e) { names = {}; }
    } else {
      try { files = await (await fetch('audio/list.json', { cache: 'no-store' })).json(); } catch (e) { files = []; }
      try { names = await (await fetch('audio/ilahiler.json', { cache: 'no-store' })).json(); } catch (e) { names = {}; }
    }
    files = files.filter((f) => /\.(mp3|m4a|ogg|wav|aac)$/i.test(f))
      .sort((a, b) => a.localeCompare(b, 'tr', { numeric: true }));
    tracks = files.map((f) => {
      const p = parseName(f), o = names[f] || {};
      return { file: f, src: 'audio/' + encodeURIComponent(f), title: o.title || p.title, artist: o.artist || p.artist };
    });
  }

  /* ---------- Liste ---------- */
  function visible() {
    const q = norm(query.trim());
    return tracks.map((t, i) => i).filter((i) => {
      const t = tracks[i];
      if (tab === 'fav' && !favs.has(t.file)) return false;
      if (q && !norm(t.title + ' ' + t.artist).includes(q)) return false;
      return true;
    });
  }

  function render() {
    $('cntAll').textContent = tracks.length;
    $('cntFav').textContent = tracks.filter((t) => favs.has(t.file)).length;
    const list = $('list');
    const idx = visible();
    if (!idx.length) {
      let head = 'Henüz ilahi eklenmedi', body = 'İlahiler eklendiğinde burada listelenecek.';
      if (tracks.length && query) { head = 'Sonuç bulunamadı'; body = '“' + query + '” için ilahi yok. Başka bir kelime deneyin.'; }
      else if (tracks.length && tab === 'fav') { head = 'Favori ilahiniz yok'; body = 'Sevdiğiniz ilahinin yanındaki kalbe dokunun, burada görünsün.'; }
      list.innerHTML = '<div class="empty"><svg><use href="#dervish"/></svg><b></b><span></span></div>';
      list.querySelector('b').textContent = head;
      list.querySelector('span').textContent = body;
      return;
    }
    const frag = document.createDocumentFragment();
    idx.forEach((i) => {
      const t = tracks[i];
      const row = document.createElement('div');
      row.className = 'row' + (i === current ? ' playing' + (audio.paused ? ' paused' : '') : '');
      row.innerHTML =
        '<button class="row-main"><span class="num"></span><span class="txt"><span class="ttl"></span><span class="art"></span></span></button>' +
        '<button class="fav" aria-label="Favori"><svg><use href="#i-heart"/></svg></button>';
      const num = row.querySelector('.num');
      if (i === current) num.innerHTML = '<span class="bars"><i></i><i></i><i></i></span>';
      else num.textContent = i + 1;
      row.querySelector('.ttl').textContent = t.title;
      const art = row.querySelector('.art');
      if (t.artist) art.textContent = t.artist; else art.remove();
      const fb = row.querySelector('.fav');
      setFavIcon(fb, favs.has(t.file));
      row.querySelector('.row-main').addEventListener('click', () => {
        if (i === current) { openPlayer(); } else { play(i); }
      });
      fb.addEventListener('click', () => toggleFav(i));
      frag.appendChild(row);
    });
    list.replaceChildren(frag);
  }

  function setFavIcon(btn, on) {
    btn.classList.toggle('on', on);
    btn.querySelector('use').setAttribute('href', on ? '#i-heart-fill' : '#i-heart');
  }

  function toggleFav(i) {
    const f = tracks[i].file;
    if (favs.has(f)) { favs.delete(f); toast('Favorilerden çıkarıldı'); }
    else { favs.add(f); toast('Favorilere eklendi'); }
    store.set('favs', [...favs]);
    render(); syncPlayer();
  }

  /* ---------- Çalma ---------- */
  function play(i) {
    if (i < 0 || i >= tracks.length) return;
    current = i;
    audio.src = tracks[i].src;
    audio.play().catch(() => {});
    store.set('last', tracks[i].file);
    $('mini').hidden = false;
    render(); syncPlayer(); setMediaSession();
  }

  function togglePlay() {
    if (current < 0) { if (tracks.length) play(visible()[0] ?? 0); return; }
    if (audio.paused) audio.play().catch(() => {}); else audio.pause();
  }

  // Sıradaki/önceki: o an görünen listeye göre (favoriler sekmesinde favorilerde dolaşır)
  function step(dir) {
    if (!tracks.length) return;
    let order = visible();
    if (!order.length || order.indexOf(current) === -1) order = tracks.map((t, i) => i);
    let pos = order.indexOf(current);
    pos = pos === -1 ? 0 : (pos + dir + order.length) % order.length;
    play(order[pos]);
  }

  function syncPlayer() {
    const playing = !audio.paused && current >= 0;
    const icon = playing ? '#i-pause' : '#i-play';
    $('miniPlay').querySelector('use').setAttribute('href', icon);
    $('miniPlay').setAttribute('aria-label', playing ? 'Duraklat' : 'Oynat');
    $('pPlay').querySelector('use').setAttribute('href', icon);
    $('pPlayLbl').textContent = playing ? 'Duraklat' : 'Oynat';
    $('disc').classList.toggle('spin', playing);
    document.querySelectorAll('.row.playing').forEach((r) => r.classList.toggle('paused', !playing));
    $('pRepeat').classList.toggle('on', repeatOne);
    $('pRepeatLbl').textContent = repeatOne ? 'Tekrar ediyor' : 'Sırayla çal';
    if (current >= 0) {
      const t = tracks[current];
      $('miniTitle').textContent = t.title;
      $('pTitle').textContent = t.title;
      $('pArtist').textContent = t.artist;
      const on = favs.has(t.file);
      setFavIcon($('pFav'), on);
      $('pFavLbl').textContent = on ? 'Favorilerde' : 'Favoriye ekle';
    }
  }

  function updateTime() {
    const d = audio.duration, c = audio.currentTime;
    const p = d > 0 ? (c / d) * 100 : 0;
    $('miniBar').style.width = p + '%';
    if (!seeking) {
      $('seek').value = Math.round(p * 10);
      $('seek').style.setProperty('--p', p + '%');
      $('tCur').textContent = fmt(c);
    }
    $('tDur').textContent = fmt(d);
  }

  function setMediaSession() {
    if (!('mediaSession' in navigator) || current < 0) return;
    try {
      const t = tracks[current];
      navigator.mediaSession.metadata = new MediaMetadata({ title: t.title, artist: t.artist || 'Mevlahi', album: 'Mevlahi' });
      navigator.mediaSession.setActionHandler('play', () => audio.play());
      navigator.mediaSession.setActionHandler('pause', () => audio.pause());
      navigator.mediaSession.setActionHandler('nexttrack', () => step(1));
      navigator.mediaSession.setActionHandler('previoustrack', () => step(-1));
    } catch (e) { /* desteklenmiyor */ }
  }

  /* ---------- Büyük çalar ---------- */
  function openPlayer() { if (current < 0) return; $('player').hidden = false; syncPlayer(); updateTime(); }
  function closePlayer() { $('player').hidden = true; }

  // Android geri tuşu: önce açık olanı kapat
  window.mevBack = function () {
    if (!$('player').hidden) { closePlayer(); return true; }
    if (query) { query = ''; $('q').value = ''; $('qClear').hidden = true; render(); return true; }
    if (tab !== 'all') { setTab('all'); return true; }
    return false;
  };

  /* ---------- Yazı boyutu ---------- */
  function applySize() {
    sizeIdx = ((sizeIdx % SIZES.length) + SIZES.length) % SIZES.length;
    document.documentElement.style.setProperty('--scale', SIZES[sizeIdx].s);
    $('textLbl').textContent = SIZES[sizeIdx].l;
    store.set('size', sizeIdx);
  }

  function setTab(t) {
    tab = t;
    document.querySelectorAll('.tab').forEach((b) => b.classList.toggle('active', b.dataset.tab === t));
    render();
  }

  /* ---------- Olaylar ---------- */
  document.querySelectorAll('.tab').forEach((b) => b.addEventListener('click', () => setTab(b.dataset.tab)));
  $('q').addEventListener('input', (e) => { query = e.target.value; $('qClear').hidden = !query; render(); });
  $('qClear').addEventListener('click', () => { query = ''; $('q').value = ''; $('qClear').hidden = true; render(); });
  $('btnText').addEventListener('click', () => { sizeIdx++; applySize(); toast('Yazı boyutu: ' + SIZES[sizeIdx].l); });

  $('miniPlay').addEventListener('click', togglePlay);
  $('miniNext').addEventListener('click', () => step(1));
  $('miniOpen').addEventListener('click', openPlayer);
  $('pClose').addEventListener('click', closePlayer);
  $('pPlay').addEventListener('click', togglePlay);
  $('pNext').addEventListener('click', () => step(1));
  $('pPrev').addEventListener('click', () => {
    if (audio.currentTime > 4) audio.currentTime = 0; else step(-1);
  });
  $('pRepeat').addEventListener('click', () => {
    repeatOne = !repeatOne; store.set('repeat', repeatOne); syncPlayer();
    toast(repeatOne ? 'Bu ilahi tekrar edecek' : 'İlahiler sırayla çalacak');
  });
  $('pFav').addEventListener('click', () => { if (current >= 0) toggleFav(current); });

  const seek = $('seek');
  seek.addEventListener('input', () => {
    seeking = true;
    const p = seek.value / 10;
    seek.style.setProperty('--p', p + '%');
    $('tCur').textContent = fmt((audio.duration || 0) * p / 100);
  });
  seek.addEventListener('change', () => {
    if (audio.duration) audio.currentTime = audio.duration * (seek.value / 1000);
    seeking = false;
  });

  audio.addEventListener('play', syncPlayer);
  audio.addEventListener('pause', syncPlayer);
  audio.addEventListener('timeupdate', updateTime);
  audio.addEventListener('loadedmetadata', updateTime);
  audio.addEventListener('ended', () => {
    if (repeatOne) { audio.currentTime = 0; audio.play().catch(() => {}); } else step(1);
  });
  audio.addEventListener('error', () => { if (current >= 0) toast('Bu ilahi açılamadı'); });

  /* ---------- Başlat ---------- */
  applySize();
  loadTracks().then(() => {
    // Son dinlenen ilahiyi hazırla (otomatik çalmaz)
    const last = store.get('last', null);
    const i = tracks.findIndex((t) => t.file === last);
    if (i >= 0) { current = i; audio.src = tracks[i].src; $('mini').hidden = false; syncPlayer(); }
    render();
  });
})();
