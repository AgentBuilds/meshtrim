const status = document.querySelector('#api-status');
const statusText = document.querySelector('#api-status-text');
const button = document.querySelector('#check-api');

async function checkHealth() {
  button.disabled = true;
  button.setAttribute('aria-busy', 'true');
  button.textContent = 'Checking…';
  status.className = 'connection-state loading';
  statusText.textContent = 'Checking API…';
  try {
    const response = await fetch('/api/health', { signal: AbortSignal.timeout(8000) });
    if (!response.ok) throw new Error('API unavailable');
    const data = await response.json();
    if (data.status !== 'ok' || data.service !== 'meshtrim') throw new Error('Invalid API response');
    status.className = 'connection-state connected';
    statusText.textContent = 'API connected';
    button.textContent = 'Check again';
  } catch {
    status.className = 'connection-state error';
    statusText.textContent = 'API unavailable. Retry the check.';
    button.textContent = 'Retry';
  } finally {
    button.disabled = false;
    button.setAttribute('aria-busy', 'false');
  }
}

button.addEventListener('click', () => void checkHealth());
void checkHealth();
