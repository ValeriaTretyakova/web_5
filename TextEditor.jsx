import React, { useState, useEffect, useRef } from 'react';

const TextEditor = ({ content, onPatch, onCursorMove, users, socket, isRegistered }) => {
  const [text, setText] = useState(content || '');
  const [localVersion, setLocalVersion] = useState(0);
  const [isSyncing, setIsSyncing] = useState(false);
  const textareaRef = useRef(null);
  const lastContentRef = useRef(content || '');
  const isProcessingRef = useRef(false);
  const pendingPatchesRef = useRef(new Map());
  const lastAppliedPatchRef = useRef(null);
  const operationBufferRef = useRef([]);
  const bufferTimerRef = useRef(null);

  // Инициализация
  useEffect(() => {
    if (content) {
      setText(content);
      lastContentRef.current = content;
    }
  }, []);

  // Синхронизация с внешним контентом
  useEffect(() => {
    if (content !== lastContentRef.current && !isProcessingRef.current) {
      console.log('Получен новый контент от сервера');
      setText(content || '');
      lastContentRef.current = content || '';
    }
  }, [content]);

  // Подписка на обновления от сервера
  useEffect(() => {
    if (!socket) {
      console.log('Socket не доступен в TextEditor');
      return;
    }

    console.log('TextEditor: Socket доступен, регистрация:', isRegistered);

    const handleApplyPatch = (patch) => {
      console.log('Получено обновление от другого пользователя:', {
        от: patch.username,
        тип: patch.type,
        позиция: patch.position,
        текст: patch.text?.substring(0, 20)
      });
      
      if (isProcessingRef.current) {
        console.log('Пропускаем патч - идет обработка');
        // Сохраняем патч для поздней обработки
        pendingPatchesRef.current.set(patch.id || Date.now(), patch);
        return;
      }
      
      // Игнорируем собственные патчи
      if (lastAppliedPatchRef.current?.id === patch.id) {
        console.log('Игнорируем собственный патч');
        return;
      }
      
      isProcessingRef.current = true;
      
      setText(prev => {
        let newText = prev;
        
        if (patch.type === 'insert' && patch.text) {
          const pos = Math.min(patch.position || 0, newText.length);
          console.log(`Вставка "${patch.text}" на позицию ${pos}`);
          newText = newText.slice(0, pos) + patch.text + newText.slice(pos);
        } else if (patch.type === 'delete' && patch.text) {
          const pos = Math.min(patch.position || 0, newText.length);
          const textToDelete = patch.text;
          const deleteLength = textToDelete.length;
          
          console.log(`Удаление "${textToDelete}" с позиции ${pos}, длина: ${deleteLength}`);
          
          if (newText.substring(pos, pos + deleteLength) === textToDelete) {
            newText = newText.slice(0, pos) + newText.slice(pos + deleteLength);
          } else {
            console.warn('Текст для удаления не совпадает, пытаемся найти совпадение');
            // Пытаемся найти текст рядом
            const foundIndex = newText.indexOf(textToDelete, Math.max(0, pos - 10));
            if (foundIndex !== -1) {
              newText = newText.slice(0, foundIndex) + newText.slice(foundIndex + deleteLength);
            }
          }
        }
        
        lastContentRef.current = newText;
        return newText;
      });
      
      setTimeout(() => {
        isProcessingRef.current = false;
        // Проверяем ожидающие патчи
        if (pendingPatchesRef.current.size > 0) {
          const nextPatch = Array.from(pendingPatchesRef.current.values())[0];
          pendingPatchesRef.current.delete(nextPatch.id || 'unknown');
          handleApplyPatch(nextPatch);
        }
      }, 50);
    };

    const handleOperationConfirmed = (confirmation) => {
      console.log('Операция подтверждена сервером:', confirmation);
      setLocalVersion(confirmation.version);
      lastAppliedPatchRef.current = null;
    };

    const handleVersionMismatch = (data) => {
      console.log('Несовпадение версий:', data);
      setIsSyncing(true);
      
      // Синхронизируем с сервером
      setText(data.currentContent);
      setLocalVersion(data.currentVersion);
      lastContentRef.current = data.currentContent;
      
      setTimeout(() => {
        setIsSyncing(false);
      }, 100);
    };

    const handleOperationError = (error) => {
      console.error('Ошибка операции:', error);
      // Можно показать уведомление пользователю
    };

    socket.on('apply-patch', handleApplyPatch);
    socket.on('operation-confirmed', handleOperationConfirmed);
    socket.on('version-mismatch', handleVersionMismatch);
    socket.on('operation-error', handleOperationError);

    return () => {
      socket.off('apply-patch', handleApplyPatch);
      socket.off('operation-confirmed', handleOperationConfirmed);
      socket.off('version-mismatch', handleVersionMismatch);
      socket.off('operation-error', handleOperationError);
    };
  }, [socket, isRegistered]);

  // Функция для нахождения разницы с оптимизацией
  const findDifference = (oldStr, newStr) => {
    if (oldStr === newStr) return null;
    
    // Оптимизированный алгоритм для быстрого нахождения различий
    const minLength = Math.min(oldStr.length, newStr.length);
    let start = 0;
    
    // Находим первую позицию различия
    while (start < minLength && oldStr[start] === newStr[start]) {
      start++;
    }
    
    // Находим последнюю позицию различия
    let oldEnd = oldStr.length - 1;
    let newEnd = newStr.length - 1;
    
    while (oldEnd >= start && newEnd >= start && 
           oldStr[oldEnd] === newStr[newEnd]) {
      oldEnd--;
      newEnd--;
    }
    
    // Определяем тип изменения
    if (newEnd < start && oldEnd >= start) {
      // Удаление
      const deletedText = oldStr.substring(start, oldEnd + 1);
      return {
        type: 'delete',
        position: start,
        text: deletedText,
        length: deletedText.length
      };
    } else if (oldEnd < start && newEnd >= start) {
      // Вставка
      return {
        type: 'insert',
        position: start,
        text: newStr.substring(start, newEnd + 1)
      };
    } else {
      // Замена (удаление + вставка)
      const deletedText = oldStr.substring(start, oldEnd + 1);
      return {
        type: 'delete',
        position: start,
        text: deletedText,
        length: deletedText.length
      };
    }
  };

  // Функция отправки патчей с буферизацией
  const sendPatch = (patch) => {
    if (!onPatch) return;
    
    const patchWithMetadata = {
      ...patch,
      id: socket?.id + '_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9),
      version: localVersion,
      timestamp: Date.now()
    };
    
    lastAppliedPatchRef.current = patchWithMetadata;
    
    // Отправляем немедленно для одиночных операций
    onPatch(patchWithMetadata);
  };

  // Обработка изменений с дебаунсом
  const handleTextChange = (e) => {
    if (!isRegistered || isSyncing) {
      e.preventDefault();
      return;
    }
    
    const newValue = e.target.value;
    const oldValue = lastContentRef.current;
    
    if (newValue === oldValue) return;
    
    setText(newValue);
    
    // Отправляем обновление позиции курсора
    if (onCursorMove) {
      onCursorMove(e.target.selectionStart);
    }
    
    // Находим разницу
    const diff = findDifference(oldValue, newValue);
    if (diff) {
      sendPatch(diff);
    }
    
    lastContentRef.current = newValue;
  };

  const handleSelectionChange = (e) => {
    if (onCursorMove && isRegistered && !isSyncing) {
      onCursorMove(e.target.selectionStart);
    }
  };

  const handleKeyDown = (e) => {
    // Предотвращаем ввод во время синхронизации
    if (isSyncing && e.key.length === 1) {
      e.preventDefault();
    }
  };

  return (
    <div className="text-editor-container">
      <div style={{ fontSize: '0.9rem', color: '#666', marginBottom: '10px' }}>
        Символов: {text.length}
      </div>
      
      <textarea
        ref={textareaRef}
        value={text}
        onChange={handleTextChange}
        onSelect={handleSelectionChange}
        onKeyDown={handleKeyDown}
        className="text-editor"
        disabled={!isRegistered || isSyncing}
        style={{
          width: '100%',
          minHeight: '400px',
          padding: '15px',
          border: isSyncing ? '2px solid #FF9800' : isRegistered ? '2px solid #4CAF50' : '2px solid #FF9800',
          borderRadius: '8px',
          fontFamily: 'monospace',
          fontSize: '16px',
          lineHeight: '1.5',
          resize: 'vertical',
          backgroundColor: isSyncing ? '#fff8e1' : isRegistered ? '#f8f9fa' : '#fff3cd',
          cursor: (!isRegistered || isSyncing) ? 'not-allowed' : 'text',
          opacity: isSyncing ? 0.8 : 1
        }}
        placeholder={
          isRegistered ? "Начните вводить текст..." :
          "Для редактирования необходимо зарегистрироваться"
        }
      />

      
      <div className="editor-info" style={{
        marginTop: '10px',
        fontSize: '0.9rem',
        color: '#666',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center'
      }}>
        <span>Пользователей онлайн: {users?.length || 0}</span>
        <div style={{ display: 'flex', gap: '10px' }}>
          <span>Статус: {isRegistered ? (isSyncing ? 'синхронизация' : 'активен') : 'неактивен'}</span>
          {isSyncing && (
            <span style={{ color: '#FF9800' }}>⏳</span>
          )}
        </div>
      </div>
    </div>
  );
};


export default TextEditor;

