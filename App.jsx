import React, { useState, useEffect } from 'react';
import io from 'socket.io-client';
import { v4 as uuidv4 } from 'uuid';
import TextEditor from './TextEditor';
import UsersList from './UsersList';
import { FiUsers, FiEdit, FiGlobe, FiCheck } from 'react-icons/fi';

const SERVER_URL = process.env.REACT_APP_SERVER_URL || 'http://localhost:5000';

function App() {
  const [socket, setSocket] = useState(null);
  const [isConnected, setIsConnected] = useState(false);
  const [username, setUsername] = useState('');
  const [registered, setRegistered] = useState(false);
  const [users, setUsers] = useState([]);
  const [documentState, setDocumentState] = useState({
    content: '',
    version: 0
  });
  const [error, setError] = useState(null);
  const [isRegistering, setIsRegistering] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);

  useEffect(() => {
    // Инициализация WebSocket соединения
    const newSocket = io(SERVER_URL, {
      reconnection: true,
      reconnectionAttempts: 5,
      reconnectionDelay: 1000
    });

    newSocket.on('connect', () => {
      console.log('Подключено к серверу');
      setIsConnected(true);
      setError(null);
    });

    newSocket.on('disconnect', () => {
      console.log('Отключено от сервера');
      setIsConnected(false);
    });

    newSocket.on('connect_error', (err) => {
      console.error('Ошибка подключения:', err);
      setError('Не удалось подключиться к серверу. Пожалуйста, проверьте соединение.');
    });

    newSocket.on('document-state', (state) => {
      console.log('Получено состояние документа:', state);
      setDocumentState(state);
    });

    newSocket.on('users-update', (updatedUsers) => {
      console.log('Обновление списка пользователей:', updatedUsers.length);
      setUsers(updatedUsers);
      
      // Проверяем, зарегистрирован ли текущий пользователь
      const currentUser = updatedUsers.find(u => u.id === newSocket.id);
      if (currentUser && !registered) {
        console.log('Автоматическая регистрация подтверждена');
        setRegistered(true);
        setError(null);
      }
    });

    newSocket.on('user-disconnected', (userId) => {
      console.log('Пользователь отключился:', userId);
      setUsers(prev => prev.filter(user => user.id !== userId));
    });

    newSocket.on('error', (err) => {
      setError(err.message);
      console.error('Ошибка сервера:', err);
    });

    // Обработчики для регистрации
    newSocket.on('registration-success', (data) => {
      console.log('Регистрация успешна:', data);
      setRegistered(true);
      setError(null);
      setIsRegistering(false);
    });

    newSocket.on('registration-error', (error) => {
      console.error('Ошибка регистрации:', error);
      setError(error.message);
      setRegistered(false);
      setIsRegistering(false);
    });

    // ДОБАВЛЕННЫЕ ОБРАБОТЧИКИ ДЛЯ СИНХРОНИЗАЦИИ
    newSocket.on('operation-confirmed', (data) => {
      console.log('Операция подтверждена сервером:', data);
      // Обновляем версию документа в фоне
      setDocumentState(prev => ({
        ...prev,
        version: data.version
      }));
    });

    newSocket.on('version-mismatch', (data) => {
      console.log('Несовпадение версий, синхронизируем:', data);
      setIsSyncing(true);
      
      // Автоматическая синхронизация
      setDocumentState({
        content: data.currentContent,
        version: data.currentVersion
      });
      
      // Автоматически скрываем синхронизацию через секунду
      setTimeout(() => {
        setIsSyncing(false);
      }, 1000);
    });

    newSocket.on('operation-error', (errorData) => {
      console.error('Ошибка операции:', errorData);
      setError(`Ошибка: ${errorData.error || 'Неизвестная ошибка'}`);
    });

    // Измерение задержки (в фоне)
    let pingInterval;
    newSocket.on('connect', () => {
      // Измеряем задержку в фоновом режиме (для логирования)
      pingInterval = setInterval(() => {
        const start = Date.now();
        newSocket.emit('ping', () => {
          const latency = Date.now() - start;
          console.log(`Задержка: ${latency}мс`);
        });
      }, 10000); // Каждые 10 секунд
    });

    newSocket.on('disconnect', () => {
      if (pingInterval) clearInterval(pingInterval);
    });

    setSocket(newSocket);

    return () => {
      if (pingInterval) clearInterval(pingInterval);
      newSocket.disconnect();
    };
  }, []);

  const handleRegister = (e) => {
    e.preventDefault();
    if (!username.trim()) {
      setError('Введите имя пользователя');
      return;
    }
  
    if (!socket || !socket.connected) {
      setError('Нет подключения к серверу');
      return;
    }

    setIsRegistering(true);
    const userData = {
      username: username.trim(),
      color: `#${Math.floor(Math.random()*16777215).toString(16).padStart(6, '0')}`
    };

    console.log('Отправка регистрации:', userData);
    socket.emit('register', userData);
  };

  const handlePatch = (patch) => {
    console.log('Отправка патча:', {
      patch,
      текущаяВерсия: documentState.version
    });
    
    if (socket && registered && socket.connected) {
      socket.emit('text-change', {
        ...patch,
        id: uuidv4(),
        version: documentState.version // Ключевое: передаем версию
      });
    }
  };

  const handleCursorMove = (position) => {
    if (socket && registered && socket.connected) {
      socket.emit('cursor-move', position);
    }
  };

  const handleLogout = () => {
    if (socket) {
      setRegistered(false);
      setUsername('');
      setError(null);
      console.log('Выход из системы');
    }
  };

  return (
    <div className="app-container">
      <header className="header">
        <h1><FiEdit /> Совместный Текстовый Редактор</h1>
        <p>Редактируйте документ вместе в реальном времени</p>
      </header>

      <main className="main-content">
        <section className="editor-section">
          <h2 className="section-title"><FiEdit /> Документ</h2>
          
          {!registered ? (
            <div className="user-form">
              <h3>Присоединиться к редактированию</h3>
              <form onSubmit={handleRegister}>
                <div className="form-group">
                  <label htmlFor="username">Имя пользователя:</label>
                  <input
                    type="text"
                    id="username"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    placeholder="Введите ваше имя"
                    required
                    maxLength="30"
                    pattern="[a-zA-Zа-яА-ЯёЁ0-9_\s]+"
                    title="Только буквы, цифры и подчеркивание"
                    disabled={isRegistering}
                  />
                </div>
                <button 
                  type="submit" 
                  className="start-button"
                  disabled={isRegistering || !isConnected}
                >
                  {isRegistering ? 'Регистрация...' : 'Начать редактирование'}
                </button>
              </form>
              
              {error && (
                <div className="error-message" style={{color: 'red', marginTop: '10px', padding: '10px', background: '#ffe6e6', borderRadius: '4px'}}>
                  {error}
                </div>
              )}
              
              {!isConnected && (
                <div style={{color: 'orange', marginTop: '10px'}}>
                  Ожидание подключения к серверу...
                </div>
              )}
            </div>
          ) : (
            <>
              <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '15px'}}>
                <div style={{display: 'flex', alignItems: 'center', gap: '10px'}}>
                  <div style={{display: 'flex', alignItems: 'center', color: 'green'}}>
                    <FiCheck /> Вы зарегистрированы как: <strong style={{marginLeft: '5px'}}>{username}</strong>
                  </div>
                </div>
                <button 
                  onClick={handleLogout}
                  style={{
                    padding: '8px 16px',
                    background: '#f44336',
                    color: 'white',
                    border: 'none',
                    borderRadius: '4px',
                    cursor: 'pointer'
                  }}
                >
                  Выйти
                </button>
              </div>
              
              {/* Показываем только если идет синхронизация */}
              {isSyncing && (
                <div style={{
                  backgroundColor: '#FF9800',
                  color: 'white',
                  padding: '10px',
                  borderRadius: '4px',
                  marginBottom: '10px',
                  textAlign: 'center'
                }}>
                  Синхронизация с сервером...
                </div>
              )}
              
              <TextEditor
                content={documentState.content}
                onPatch={handlePatch}
                onCursorMove={handleCursorMove}
                users={users}
                socket={socket}
                isRegistered={registered}
              />
            </>
          )}
        </section>

        <section className="users-section">
          <h2 className="section-title"><FiUsers /> Участники ({users.length})</h2>
          
          <UsersList users={users} />
          
          <div className="connection-status">
            <h3><FiGlobe /> Статус соединения</h3>
            <p className={isConnected ? 'status-connected' : 'status-disconnected'}>
              {isConnected ? 'Подключено' : 'Отключено'}
            </p>
            <div style={{ marginTop: '10px', fontSize: '0.9rem' }}>
              <p style={{ color: '#666' }}>ID соединения: {socket?.id || 'нет'}</p>
              <p style={{ color: registered ? 'green' : 'orange', marginTop: '5px' }}>
                {registered ? 'Зарегистрирован' : 'Не зарегистрирован'}
              </p>
            </div>
          </div>
        </section>
      </main>

      <footer className="footer">
        <p>Real-time Collaborative Editor | Пользователей онлайн: {users.length}</p>
      </footer>
    </div>
  );
}

export default App;