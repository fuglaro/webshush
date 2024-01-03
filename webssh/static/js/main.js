/**
 * Manages establishing the proxy connection between the terminal and
 * the ssh channel and handles all the customisations to the terminal
 * and the input controls.
 */

// Prevent as many browser shortcuts (except copy and paste).
// Note the browser will not repect this for some reserved shortcuts.
window.addEventListener('keydown', e => {
  let mods = [+e.altKey, +e.ctrlKey, +e.metaKey, +e.shiftKey].join('')
  if (mods == '0000' || mods == '0001') return
  if ((e.code == 'KeyC' || e.code == 'KeyV') && (mods == '0010' || mods == '0100'))
    return
  e.preventDefault()
})

// Update values in the form with details in the URL.
for (const [key, value] of new URL(document.location).searchParams.entries()) {
  let el = document.getElementById(key)
  if (el && el.nodeName == "INPUT") el.value = value
}

// msgQueue: preserves order of ssh messages sent to the terminal.
let msgQueue = Promise.resolve()
let statusMsg = document.getElementById("status")
var term

window.onresize = () => term && term.___resize___()


/**
 * Load Alacritty style TOML theme.
 * @param {string} contents - The theme file contents.
 */
function loadTheme(contents) {
  var theme = {}
  contents.split('[colors.')
    .forEach(s => {
      var p = s.split(']')[0]
      if (['primary', 'cursor', 'normal'].includes(p)) p = ''
      else if (!['bright', 'dim'].includes(p)) return
      s.split('\n').filter(l => / *[a-z]+ *= *'#[0-9a-fA-F]{6} *'/.exec(l))
        .forEach(l => {
          var [n, v] = l.trim().split(/ *= */)
          n = p ? p + n.charAt(0).toUpperCase() + n.slice(1) : n
          n = n == 'text' ? 'cursorAccent' : n
          theme[n] = v.replaceAll("'", "")
        })
    })
  return theme
}
const themes = (`alacritty,afterglow,alabaster,alabaster_dark,alacritty_0_12,argonaut,
atom_one_light,ayu_dark,ayu_light,baitong,base16_default_dark,blood_moon,bluish,breeze,
campbell,carbonfox,catppuccin,catppuccin_frappe,catppuccin_latte,catppuccin_macchiato,
catppuccin_mocha,challenger_deep,citylights,Cobalt2,cyber_punk_neon,darcula,dark_pastels,
deep_space,default,doom_one,dracula,everforest_dark,everforest_light,falcon,flat_remix,
flexoki,github_dark,github_dark_colorblind,github_dark_default,github_dark_dimmed,
github_dark_high_contrast,github_dark_tritanopia,github_light,github_light_colorblind,
github_light_default,github_light_high_contrast,github_light_tritanopia,gnome_terminal,
gotham,gruvbox_dark,gruvbox_light,gruvbox_material,gruvbox_material_medium_dark,
gruvbox_material_medium_light,hardhacker,high_contrast,horizon-dark,hyper,inferno,iris,
iterm,kanagawa_dragon,kanagawa_wave,konsole_linux,low_contrast,Mariana,marine_dark,
material_theme,material_theme_mod,meliora,midnight-haze,monokai_charcoal,monokai_pro,
moonlight_ii_vscode,msx,night_owlish_light,nightfox,noctis-lux,nord,nord_light,nordic,
oceanic_next,omni,one_dark,palenight,papercolor_dark,papercolor_light,papertheme,
pencil_dark,pencil_light,rainbow,remedy_dark,rose-pine-dawn,rose-pine-moon,rose-pine,
seashells,smoooooth,snazzy,solarized_dark,solarized_light,taerminal,tango_dark,tender,
terminal_app,thelovelace,tokyo-night-storm,tokyo-night,tomorrow_night,
tomorrow_night_bright,ubuntu,wombat,xterm,zenburn`).replaceAll('\n', '').split(',')
{
  let themeOptions = document.getElementById('themes')
  themes.forEach(t => {
    opt = document.createElement('option')
    opt.value = t
    themeOptions.appendChild(opt)
  })
}

/**
 * Disconnects any existing established terminal ssh connection,
 * and return to the login screen.
 */
function disconnect() {
  document.title = 'WebShuSH'
  document.body.classList.remove("connected")
  if (!term) return
  term.dispose()
  term = undefined
}


/**
 * Establish an ssh connection proxied through a websocket server in
 * the backend using the details and credentioals in the login form,
 * and display the connected terminal fullscreened.
 */
async function connect() {
  // Only allow one connection at a time.
  if (document.title !== 'WebShuSH') return


  // Validate form values
  let form = document.getElementById("login")
  let data = new FormData(form)
  let hostname = data.get('hostname')
  statusMsg.innerText = ''
  if (!hostname_validator.test(hostname))
    statusMsg.innerText = 'Invalid hostname: ' + hostname
  let pk = data.get('privatekey')
  if (pk.name && (pk.size > 16384 || !pk.size || !await pk.text()))
    statusMsg.innerText = 'Invalid key ' + pk.name
  if (statusMsg.innerText) return


  // Request connection
  const resp = await fetch(form.action, {
    // TODO: This shouldn't be forced to send a connection request
    // before establishing the WebSocket link. It will require a
    // backand update, but this should be able establish a WebSocket
    // connection directly by sending the credentials in the WebSocket
    // request. This would simplify the code, and also remove the
    // vulnerability that connections are established but never
    // closed.
    method: "POST",
    body: data,
  })


  // Validate response
  if (resp.status !== 200) {
    statusMsg.innerText = `Proxy failed: ${resp.statusText} (${resp.status})`
    disconnect()
    return
  }
  let r = await resp.json()
  if (!r.id) {
    statusMsg.innerText = r.status
    disconnect()
    return
  }


  // Connect terminal
  let loc = window.location
  let url = `${loc.protocol === 'http:' ? 'ws:' : 'wss:'}//${loc.host}/ws?id=${r.id}`
  let sock = new window.WebSocket(url)

  sock.onopen = async () => {
    let container = document.getElementById('terminal')
    let currentTheme = document.getElementById('theme')
    // copyMode: Allow Ctrl+c & Ctrl+v shortcuts (0-off 1-off-init 2-on 3-on-deinit)
    var copyMode = 0

    term = new window.Terminal({
      'fontFamily': container.style.fontFamily,
      'theme': loadTheme(await (await fetch(
        `/static/themes/${data.get('theme')}.toml`)).text()),
    })
    term.onData(data => sock.send(JSON.stringify({ 'data': data })))
    fitAddon = new window.FitAddon.FitAddon()
    term.loadAddon(fitAddon)
    term.open(container)
    term.___resize___ = () => {
      fitAddon.fit()
      sock.send(JSON.stringify({ 'resize': [term.cols, term.rows] }))
    }
    term.___resize___()
    term.focus()

    term.attachCustomKeyEventHandler(e => {
      if (e.type != 'keydown') return
      let mods = [+e.altKey, +e.ctrlKey, +e.metaKey, +e.shiftKey].join('')

      // Handle font size controls.
      if (mods == '0101' && e.code == 'Minus') {
        term.options.fontSize--
        term.___resize___()
        return false
      } else if (mods == '0101' && e.code == 'Equal') {
        term.options.fontSize++
        term.___resize___()
        return false
      }

      // Handle theme switching.
      if (mods == '1100' && (e.code == 'Minus' || e.code == 'Equal')) {
        let d = e.code == 'Equal' ? 1 : -1
        let l = themes.length
        nextTheme = themes[((themes.indexOf(currentTheme.value) + d) % l + l) % l]
        currentTheme.value = nextTheme
        fetch(`/static/themes/${nextTheme}.toml`).then(r => r.text().then(
          t => term.options.theme = loadTheme(t)))
        return false
      }

      // Handle Copy/Paste Mode.
      // Update copyMode
      if (mods == '0001' && e.code == 'ShiftLeft')
        copyMode = (copyMode + 1) % 4
      else
        copyMode = (copyMode >> 1) << 1
      // Update the copyMode indicator
      if (document.body.classList.contains('copyMode') != copyMode >= 2)
        document.body.classList.toggle('copyMode')
      // Don't send copy/paste shortcuts if in copyMode
      let copypaste = (e.code == 'KeyC' || e.code == 'KeyV') && mods == '0100'
      return copyMode < 2 || !copypaste;
    });
  }

  sock.onmessage = msg => msgQueue = msgQueue.then(
    () => msg.data.text().then(m => term && term.write(m)))

  sock.onerror = sock.onclose = e => {
    statusMsg.innerText = e.reason || e.type || e
    document.body.classList.remove('copyMode')
    disconnect()
  }

  document.title = `WebShuSH (${data.get('hostname')})`
  document.body.classList.add("connected")
}
