const input = document.getElementById('erp-url')
const message = document.getElementById('message')

chrome.storage.local.get({ erpUrl: '' }).then(({ erpUrl }) => {
  input.value = erpUrl
})

document.getElementById('open-erp').addEventListener('click', async () => {
  let url
  try {
    url = new URL(input.value.trim())
  } catch {
    message.textContent = 'Informe o endereço HTTPS do servidor Core Cut ERP.'
    return
  }

  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname))) {
    message.textContent = 'Use HTTPS. HTTP só é permitido para testes neste computador.'
    return
  }

  await chrome.storage.local.set({ erpUrl: url.origin })
  await chrome.tabs.create({ url: url.origin })
  window.close()
})
