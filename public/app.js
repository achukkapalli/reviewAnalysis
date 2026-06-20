// Application State
let activeWeek = null;
let reportsList = [];
let currentStakeholders = [];

// DOM Elements
const weekDropdown = document.getElementById('week-dropdown');
const stakeholderListTextarea = document.getElementById('stakeholder-list');
const updateStakeholdersBtn = document.getElementById('update-stakeholders-btn');
const runPipelineBtn = document.getElementById('run-pipeline-btn');
const customWeekInput = document.getElementById('custom-week-input');
const forceRunChk = document.getElementById('force-run-chk');

const docStatusBadge = document.getElementById('doc-status-badge');
const docLinkBtn = document.getElementById('doc-link-btn');
const emailStatusBadge = document.getElementById('email-status-badge');

const reportEmptyState = document.getElementById('report-empty-state');
const reportLoadingState = document.getElementById('report-loading-state');
const reportContentArea = document.getElementById('report-content-area');
const reportTitleText = document.getElementById('report-title-text');
const reportTimestampText = document.getElementById('report-timestamp-text');
const themesGrid = document.getElementById('themes-grid');

const toastContainer = document.getElementById('toast-container');

// Core Functions
async function init() {
  await fetchStakeholders();
  await refreshReportsList();
}

/**
 * Show modern visual toast alerts
 */
function showToast(message, type = 'success') {
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  
  // Icon select
  let icon = '';
  if (type === 'success') {
    icon = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>';
  } else if (type === 'error') {
    icon = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>';
  } else {
    icon = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>';
  }
  
  toast.innerHTML = `${icon}<span>${message}</span>`;
  toastContainer.appendChild(toast);
  
  // Auto remove after 4.5 seconds
  setTimeout(() => {
    toast.style.animation = 'slide-up 0.3s reverse forwards';
    setTimeout(() => toast.remove(), 300);
  }, 4500);
}

/**
 * Fetch and display current stakeholders
 */
async function fetchStakeholders() {
  try {
    const res = await fetch('/api/stakeholders');
    const data = await res.json();
    currentStakeholders = data.emails || [];
    stakeholderListTextarea.value = currentStakeholders.join(', ');
  } catch (err) {
    showToast('Failed to load stakeholder emails', 'error');
  }
}

/**
 * Fetch list of all reports and populate selector
 */
async function refreshReportsList(selectedWeekToForce = null) {
  try {
    const res = await fetch('/api/reports');
    reportsList = await res.json();
    
    // Clear select
    weekDropdown.innerHTML = '';
    
    if (reportsList.length === 0) {
      const opt = document.createElement('option');
      opt.text = 'No reports run yet';
      opt.disabled = true;
      opt.selected = true;
      weekDropdown.appendChild(opt);
      showEmptyState();
      return;
    }
    
    reportsList.forEach(report => {
      const opt = document.createElement('option');
      opt.value = report.week;
      opt.text = `Groww Weekly Digest (${report.week})`;
      weekDropdown.appendChild(opt);
    });

    // Select active week: force override, or keep active, or pick first (most recent)
    let targetWeek = selectedWeekToForce || activeWeek || reportsList[0].week;
    
    // Ensure target week exists in list
    if (!reportsList.some(r => r.week === targetWeek)) {
      targetWeek = reportsList[0].week;
    }
    
    weekDropdown.value = targetWeek;
    activeWeek = targetWeek;
    
    await loadReport(targetWeek);
  } catch (err) {
    showToast('Failed to query reports history', 'error');
  }
}

/**
 * Load and render a specific report summary
 */
async function loadReport(week) {
  showLoadingState();
  try {
    const res = await fetch(`/api/reports/${week}`);
    if (!res.ok) throw new Error('Report data fetch failed');
    const report = await res.json();
    
    activeWeek = report.week;
    renderReportDetails(report);
  } catch (err) {
    showToast(`Error reading report for ${week}`, 'error');
    showEmptyState();
  }
}

function showEmptyState() {
  reportEmptyState.classList.remove('hidden');
  reportLoadingState.classList.add('hidden');
  reportContentArea.classList.add('hidden');
}

function showLoadingState() {
  reportEmptyState.classList.add('hidden');
  reportLoadingState.classList.remove('hidden');
  reportContentArea.classList.add('hidden');
}

function renderReportDetails(report) {
  reportEmptyState.classList.add('hidden');
  reportLoadingState.classList.add('hidden');
  reportContentArea.classList.remove('hidden');

  // Set titles & timestamp
  reportTitleText.textContent = `Weekly Pulse — ${report.week}`;
  
  const parsedDate = new Date(report.timestamp);
  const options = { year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' };
  reportTimestampText.textContent = `Generated on ${parsedDate.toLocaleDateString(undefined, options)}`;

  // Google Doc Link & Status update
  if (report.docUrl) {
    docStatusBadge.textContent = 'Success / Updated';
    docStatusBadge.className = 'status-value success';
    
    docLinkBtn.href = report.docUrl;
    docLinkBtn.classList.remove('disabled-link');
  } else {
    docStatusBadge.textContent = 'Not Created';
    docStatusBadge.className = 'status-value danger';
    
    docLinkBtn.href = '#';
    docLinkBtn.classList.add('disabled-link');
  }

  // Gmail status update
  if (report.gmailId) {
    let rawDraft = report.gmailId;
    let draftMsg = 'Draft Created';
    
    try {
      const parsedId = JSON.parse(report.gmailId);
      if (parsedId.draft_id || parsedId.draftId) {
        rawDraft = parsedId.draft_id || parsedId.draftId;
      }
    } catch (e) {}

    // truncate draft id for aesthetic display
    const shortId = rawDraft.length > 15 ? `${rawDraft.substring(0, 12)}...` : rawDraft;
    emailStatusBadge.textContent = `${draftMsg} (ID: ${shortId})`;
    emailStatusBadge.className = 'status-value success';
    emailStatusBadge.title = `Gmail Reference: ${rawDraft}`;
  } else {
    emailStatusBadge.textContent = 'Not Sent / Skipped';
    emailStatusBadge.className = 'status-value warning';
    emailStatusBadge.title = '';
  }

  // Render Themes Grid
  themesGrid.innerHTML = '';
  
  if (!report.themes || report.themes.length === 0) {
    const notice = document.createElement('p');
    notice.style.gridColumn = '1 / -1';
    notice.style.color = 'var(--text-muted)';
    notice.style.fontStyle = 'italic';
    notice.textContent = 'No summarized themes found for this execution run. Pipeline might have logged a skip.';
    themesGrid.appendChild(notice);
    return;
  }

  report.themes.forEach(theme => {
    const card = document.createElement('div');
    card.className = 'theme-card glass-card';
    
    // Header
    const cardHeader = document.createElement('div');
    cardHeader.className = 'theme-card-header';
    cardHeader.innerHTML = `<h3>${theme.themeName}</h3><span class="badge">sentiment</span>`;
    card.appendChild(cardHeader);
    
    // Description
    const desc = document.createElement('p');
    desc.className = 'theme-desc';
    desc.textContent = theme.themeDescription;
    card.appendChild(desc);
    
    // Quotes (Representative Quotes)
    if (theme.representativeQuotes && theme.representativeQuotes.length > 0) {
      const quotesContainer = document.createElement('div');
      quotesContainer.className = 'quotes-container';
      quotesContainer.innerHTML = `<div class="quotes-label">Representative Quotes</div>`;
      
      theme.representativeQuotes.forEach(quote => {
        const bubble = document.createElement('div');
        bubble.className = 'quote-bubble';
        bubble.textContent = `"${quote}"`;
        quotesContainer.appendChild(bubble);
      });
      card.appendChild(quotesContainer);
    }
    
    // Action Ideas (Action Items)
    if (theme.actionIdeas && theme.actionIdeas.length > 0) {
      const actionsContainer = document.createElement('div');
      actionsContainer.className = 'actions-container';
      actionsContainer.innerHTML = `<div class="action-label">Action Ideas</div>`;
      
      const list = document.createElement('ol');
      list.className = 'actions-list';
      theme.actionIdeas.forEach(action => {
        const li = document.createElement('li');
        li.textContent = action;
        list.appendChild(li);
      });
      
      actionsContainer.appendChild(list);
      card.appendChild(actionsContainer);
    }

    themesGrid.appendChild(card);
  });
}

// Event Listeners

// Selector Dropdown Change
weekDropdown.addEventListener('change', (e) => {
  loadReport(e.target.value);
});

// Update Stakeholders and Draft Email
updateStakeholdersBtn.addEventListener('click', async () => {
  const emailsText = stakeholderListTextarea.value.trim();
  const emailsArray = emailsText.split(',').map(e => e.trim()).filter(e => e.length > 0);

  if (emailsArray.length === 0) {
    showToast('Please enter at least one valid stakeholder email address.', 'error');
    return;
  }

  // UI loading feedback
  updateStakeholdersBtn.disabled = true;
  const btnText = updateStakeholdersBtn.querySelector('.btn-text');
  const btnSpinner = updateStakeholdersBtn.querySelector('.btn-spinner');
  btnText.textContent = 'Drafting email...';
  btnSpinner.classList.remove('hidden');

  try {
    const res = await fetch('/api/stakeholders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        emails: emailsArray,
        activeWeek: activeWeek
      })
    });

    if (!res.ok) throw new Error('API server failed to update stakeholders');

    const result = await res.json();
    currentStakeholders = result.emails;
    stakeholderListTextarea.value = currentStakeholders.join(', ');
    
    showToast('Stakeholders saved & Gmail teaser draft created!', 'success');
    
    // Refresh report view details to update the Gmail draft ID
    if (activeWeek) {
      await loadReport(activeWeek);
    }
  } catch (err) {
    showToast(err.message || 'Error updating stakeholders.', 'error');
  } finally {
    updateStakeholdersBtn.disabled = false;
    btnText.textContent = 'Update & Draft Email';
    btnSpinner.classList.add('hidden');
  }
});

// Run Pipeline manually
runPipelineBtn.addEventListener('click', async () => {
  const customWeek = customWeekInput.value.trim();
  const force = forceRunChk.checked;

  if (customWeek && !/^\d{4}-W\d{2}$/.test(customWeek)) {
    showToast('Invalid week format! Use YYYY-Www, e.g. 2026-W24', 'error');
    return;
  }

  // UI loading feedback
  runPipelineBtn.disabled = true;
  runPipelineBtn.textContent = 'Analyzing...';
  showLoadingState();

  try {
    const res = await fetch('/api/run-pulse', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        week: customWeek || null,
        force
      })
    });

    if (!res.ok) throw new Error('Pipeline processing encountered an error');

    const data = await res.json();
    showToast(`Analysis run completed for ${customWeek || 'current week'}!`, 'success');
    
    // Reset custom inputs
    customWeekInput.value = '';
    forceRunChk.checked = false;
    
    // Reload lists to fetch the newly created report
    await refreshReportsList(customWeek || null);
  } catch (err) {
    showToast(err.message || 'Error executing review analysis pipeline.', 'error');
    if (activeWeek) {
      await loadReport(activeWeek);
    } else {
      showEmptyState();
    }
  } finally {
    runPipelineBtn.disabled = false;
    runPipelineBtn.textContent = 'Run Analysis';
  }
});

// Start Up
init();
