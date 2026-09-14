export async function openAiChat(page) {
  const panel = page.locator('#ai-chat-window')
  if (!await panel.isVisible()) await page.locator('#ai-assistant-launcher').click()
  await panel.waitFor({ state: 'visible' })
}
