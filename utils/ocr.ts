import { GoogleGenAI } from "@google/genai";

export async function extractTextFromImage(file: File, apiKey: string): Promise<string> {
  if (!apiKey) throw new Error("API Key is required for OCR");

  const ai = new GoogleGenAI({ apiKey });
  
  // Convert file to Base64
  const base64Data = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      // Remove Data URL prefix (e.g. "data:image/jpeg;base64,")
      const base64 = result.split(',')[1];
      resolve(base64);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });

  // Call Gemini Flash for fast OCR
  const response = await ai.models.generateContent({
    model: 'gemini-2.5-flash',
    contents: {
      parts: [
        {
          inlineData: {
            mimeType: file.type,
            data: base64Data
          }
        },
        {
          text: "قم باستخراج جميع النصوص الموجودة في هذه الصورة بدقة عالية باللغة العربية. لا تضف أي شرح، فقط النص الموجود."
        }
      ]
    }
  });

  return response.text || "لم يتم العثور على نص.";
}