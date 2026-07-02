import { Component, ElementRef, ViewChild, AfterViewChecked, effect } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { ChatbotService } from '../../../core/services/chatbot.service';

@Component({
  selector: 'app-chatbot',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    MatIconModule,
    MatButtonModule
  ],
  templateUrl: './chatbot.component.html',
  styleUrls: ['./chatbot.component.css']
})
export class ChatbotComponent implements AfterViewChecked {
  @ViewChild('scrollContainer') private scrollContainer!: ElementRef;
  @ViewChild('chatInput') private chatInput!: ElementRef;

  userMessageText = '';
  private shouldScrollToBottom = false;

  constructor(
    public chatbotService: ChatbotService,
    private sanitizer: DomSanitizer
  ) {
    // Monitor messages signal changes to trigger automatic scrolling
    effect(() => {
      const msgs = this.chatbotService.messages();
      if (msgs.length > 0) {
        this.shouldScrollToBottom = true;
      }
    });

    // Monitor open state changes
    effect(() => {
      const open = this.chatbotService.isOpen();
      if (open) {
        this.shouldScrollToBottom = true;
        // Focus the input box shortly after opening
        setTimeout(() => {
          this.focusInput();
          this.adjustInputHeight();
        }, 150);
      }
    });
  }

  ngAfterViewChecked() {
    if (this.shouldScrollToBottom) {
      this.scrollToBottom();
      this.shouldScrollToBottom = false;
    }
  }

  sendUserMessage() {
    const text = this.userMessageText.trim();
    if (!text) return;

    this.chatbotService.sendMessage(text);
    this.userMessageText = '';
    
    // Reset height of input textarea
    setTimeout(() => this.adjustInputHeight(), 0);
  }

  selectSuggestion(suggestion: string) {
    this.chatbotService.sendMessage(suggestion);
  }

  clearChat() {
    if (confirm('Tem a certeza que deseja limpar o histórico de conversas?')) {
      this.chatbotService.clearChat();
    }
  }

  onEnterKey(event: Event) {
    const keyboardEvent = event as KeyboardEvent;
    // If shift+enter is pressed, let it create a newline. Otherwise, send message.
    if (!keyboardEvent.shiftKey) {
      keyboardEvent.preventDefault();
      this.sendUserMessage();
    }
  }

  private focusInput() {
    if (this.chatInput && this.chatInput.nativeElement) {
      this.chatInput.nativeElement.focus();
    }
  }

  private adjustInputHeight() {
    if (this.chatInput && this.chatInput.nativeElement) {
      const textarea = this.chatInput.nativeElement;
      textarea.style.height = 'auto';
      textarea.style.height = Math.min(textarea.scrollHeight, 100) + 'px';
    }
  }

  private scrollToBottom(): void {
    try {
      if (this.scrollContainer && this.scrollContainer.nativeElement) {
        const element = this.scrollContainer.nativeElement;
        element.scrollTop = element.scrollHeight;
      }
    } catch (err) {
      console.warn('Could not scroll chatbot container to bottom:', err);
    }
  }

  /**
   * Helper function to escape HTML and do a basic markdown format:
   * - **bold** to <strong>bold</strong>
   * - `code` to <code>code</code>
   * - lines starting with * or - to unordered lists
   * - newlines to <br>
   */
  sanitizeAndFormat(content: string): SafeHtml {
    if (!content) return '';

    // Step 1: Escape HTML characters to prevent XSS
    let escaped = content
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');

    // Step 2: Render code backticks `code`
    escaped = escaped.replace(/`([^`]+)`/g, '<code>$1</code>');

    // Step 3: Render bold tags **bold**
    escaped = escaped.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');

    // Step 4: Render simple lists
    const lines = escaped.split('\n');
    let inList = false;
    let listFormatted = '';

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      
      // Match lines starting with * or - followed by space
      const isListItem = line.startsWith('* ') || line.startsWith('- ');
      
      if (isListItem) {
        if (!inList) {
          listFormatted += '<ul>';
          inList = true;
        }
        listFormatted += `<li>${line.substring(2)}</li>`;
      } else {
        if (inList) {
          listFormatted += '</ul>';
          inList = false;
        }
        
        // Add paragraph or newline
        if (line === '') {
          listFormatted += '<br>';
        } else {
          listFormatted += (listFormatted ? '<br>' : '') + line;
        }
      }
    }

    if (inList) {
      listFormatted += '</ul>';
    }

    // Step 5: Safe-bypass sanitizer
    return this.sanitizer.bypassSecurityTrustHtml(listFormatted);
  }
}
