import { CustomerDetails, ChatMessage } from '../types';

export function exportToCSV(customerData: CustomerDetails[], transcript: ChatMessage[]) {
  // 1. Customer Data CSV
  if (customerData.length > 0) {
    const headers = ['Full Name', 'Phone', 'Income', 'Age', 'Insurance Type', 'Timestamp'];
    const rows = customerData.map(c => [
      `"${c.fullName}"`,
      `"${c.phoneNumber}"`,
      `"${c.monthlyIncome}"`,
      `"${c.age}"`,
      `"${c.insuranceType}"`,
      `"${c.timestamp}"`
    ]);
    
    const csvContent = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
    downloadFile(csvContent, `magma_care_customers_${new Date().toISOString()}.csv`);
  }

  // 2. Transcript CSV
  if (transcript.length > 0) {
    const tHeaders = ['Timestamp', 'Role', 'Message'];
    const tRows = transcript.map(t => [
      `"${t.timestamp.toISOString()}"`,
      `"${t.role}"`,
      `"${t.text.replace(/"/g, '""')}"` // Escape quotes
    ]);

    const tCsvContent = [tHeaders.join(','), ...tRows.map(r => r.join(','))].join('\n');
    downloadFile(tCsvContent, `magma_care_transcript_${new Date().toISOString()}.csv`);
  }
}

function downloadFile(content: string, filename: string) {
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  if (link.download !== undefined) {
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', filename);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }
}
