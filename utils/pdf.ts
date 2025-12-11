import * as pdfjsLib from 'pdfjs-dist';

// Handle ESM import inconsistencies (sometimes it's .default, sometimes it's the module itself)
const pdfjs = (pdfjsLib as any).default || pdfjsLib;

// Set worker source (mapped in index.html or standard CDN)
// Ensure the worker version matches the library version
if (pdfjs.GlobalWorkerOptions) {
  pdfjs.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
} else {
    console.error("PDF.js GlobalWorkerOptions could not be found on the imported module.");
}

export async function extractTextFromPDF(file: File): Promise<string> {
  const arrayBuffer = await file.arrayBuffer();
  
  // Use the resolved pdfjs object to call getDocument
  const loadingTask = pdfjs.getDocument({ data: arrayBuffer });
  const pdf = await loadingTask.promise;
  
  let fullText = '';
  
  // Limit pages to avoid browser crashing on massive books (optional, current limit 50)
  const maxPages = Math.min(pdf.numPages, 50); 

  for (let i = 1; i <= maxPages; i++) {
    const page = await pdf.getPage(i);
    const textContent = await page.getTextContent();
    // Type assertion for items as they are generic
    const pageText = (textContent.items as any[]).map((item: any) => item.str).join(' ');
    fullText += `--- Page ${i} ---\n${pageText}\n`;
  }

  return fullText;
}