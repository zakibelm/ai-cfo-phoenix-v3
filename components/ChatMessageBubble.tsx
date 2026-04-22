import React, { useEffect, useRef } from 'react';
import { ChatMessage } from '../types';
import { AgentIcon } from './AgentIcon';
import { ToolIcon } from './icons/ToolIcon';
import { gsap } from 'gsap';
import { getAgentRoleByName } from '../data/agents';

interface ChatMessageBubbleProps {
  message: ChatMessage;
}

const ToolCallDisplay: React.FC<{ toolCall: ChatMessage['toolCalls'][0] }> = ({ toolCall }) => (
    <div className="tool-call-display">
        <ToolIcon />
        <div className="tool-call-content">
            <p>{toolCall.toolName}</p>
            <p>{JSON.stringify(toolCall.input)}</p>
        </div>
    </div>
);


export const ChatMessageBubble: React.FC<ChatMessageBubbleProps> = ({ message }) => {
  const { role, content, agent, isError, toolCalls } = message;
  const bubbleRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (bubbleRef.current) {
        const animation = gsap.fromTo(bubbleRef.current, 
            { opacity: 0, y: 20 },
            { opacity: 1, y: 0, duration: 0.5, ease: 'power3.out' }
        );
        // MEMORY: Cleanup GSAP animation to prevent leaks on unmount
        return () => {
            animation.kill();
        };
    }
  }, []);

  const isUser = role === 'user';

  return (
    <div ref={bubbleRef} className={`chat-bubble-container ${isUser ? 'user' : ''}`}>
      {!isUser && (
        <div className={`chat-avatar model ${isError ? 'error' : ''}`}>
          <AgentIcon agent={agent || ''} />
        </div>
      )}

      <div className={`chat-bubble ${isUser ? 'user' : `model ${isError ? 'error' : ''}`}`}>
        {!isUser && agent && (
          <div className="chat-bubble-agent">
            <p>{getAgentRoleByName(agent)}</p>
          </div>
        )}
        
        {toolCalls && toolCalls.length > 0 && (
            <div className="tool-calls-container">
                {toolCalls.map((tool, index) => <ToolCallDisplay key={index} toolCall={tool} />)}
            </div>
        )}
        
        <div className="chat-bubble-content">
            {content}
        </div>
      </div>

      {isUser && (
        <div className="chat-avatar user">
          <span>You</span>
        </div>
      )}
    </div>
  );
};