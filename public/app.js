const form = document.querySelector('#form');
const status = document.querySelector('#status');
const phoneKey = 'transmission-maman-whatsapp';
form.date.value = new Date().toISOString().slice(0, 10);
form.recipientPhone.value = localStorage.getItem(phoneKey) || '';

function readImages(files) {
  return Promise.all([...files].map(file => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve({ name: file.name, data: reader.result });
    reader.onerror = reject;
    reader.readAsDataURL(file);
  })));
}

function pdfFile(base64, filename) {
  const bytes = Uint8Array.from(atob(base64), character => character.charCodeAt(0));
  return new File([bytes], filename, { type: 'application/pdf' });
}

function downloadFile(file) {
  const link = document.createElement('a');
  link.href = URL.createObjectURL(file);
  link.download = file.name;
  link.click();
  URL.revokeObjectURL(link.href);
}

function greeting(date) {
  return `Bonjour, veuillez trouver ci-joint la transmission quotidienne de maman du ${date}. Bonne réception et bonne journée.`;
}

form.addEventListener('submit', async event => {
  event.preventDefault();
  const phone = form.recipientPhone.value.trim();
  const international = phone.replace(/[\s().-]/g, '');
  if (!/^\+\d{8,15}$/.test(international)) { status.textContent = 'Erreur : utilisez un numéro international, par exemple +2250700000000.'; return; }
  status.textContent = 'Enregistrement en cours…';
  try {
    const data = Object.fromEntries(new FormData(form));
    const images = await readImages(form.dayImages.files);
    data.dayImages = images.map(image => image.name).join(', ');
    data.imageData = images;
    data.recipientPhone = international;
    localStorage.setItem(phoneKey, international);
    const response = await fetch('/api/transmissions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Impossible d’enregistrer la transmission.');
    const file = pdfFile(result.pdf, result.filename);
    const message = greeting(form.date.value);
    if (navigator.canShare?.({ files: [file] }) && navigator.share) {
      await navigator.share({ files: [file], text: message });
      status.textContent = '✓ Enregistré. Choisissez WhatsApp, le destinataire, puis envoyez le PDF.';
    } else {
      downloadFile(file);
      window.open(`https://wa.me/${international.slice(1)}?text=${encodeURIComponent(message)}`, '_blank', 'noopener');
      status.textContent = '✓ Enregistré. Le PDF est téléchargé et WhatsApp est ouvert.';
    }
  } catch (error) { status.textContent = `Erreur : ${error.message}`; }
});
