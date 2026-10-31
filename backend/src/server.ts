import { createServer } from 'node:http';
import { createApp } from './app';
import { env } from './config/env';
import {
  startReminderScheduler,
  stopReminderScheduler,
} from './modules/card/reminder.scheduler';
import {
  startDigestScheduler,
  stopDigestScheduler,
} from './modules/notification/digest.scheduler';
import {
  startRecurringScheduler,
  stopRecurringScheduler,
} from './modules/card/recurringSchedule.scheduler';
import { startRiskScheduler, stopRiskScheduler } from './modules/risk/risk.scheduler';
import { initRealtime, shutdownRealtime } from './realtime/socket';

function startServer() {
  try {
    const app = createApp();
    const server = createServer(app);

    // Gan Socket.IO (realtime) vao cung HTTP server
    initRealtime(server);
    startReminderScheduler();
    startDigestScheduler();
    startRecurringScheduler();
    startRiskScheduler();

    server.listen(env.port, () => {
      console.log(`Server dang chay tai http://localhost:${env.port}`);
      console.log(`Moi truong: ${env.nodeEnv}`);
      console.log(`Kiem tra: http://localhost:${env.port}/api/health`);
    });

    // Cong da bi chuong trinh khac chiem -> bao loi ro rang thay vi crash kho hieu
    server.on('error', (error: NodeJS.ErrnoException) => {
      if (error.code === 'EADDRINUSE') {
        console.error(
          `Cong ${env.port} dang bi chuong trinh khac su dung. Hay doi PORT trong file .env.`
        );
      } else {
        console.error('Khong khoi dong duoc server:', error.message);
      }
      process.exit(1);
    });

    // Tat server mot cach an toan khi nhan tin hieu dung (Ctrl + C)
    const shutdown = (signal: string) => {
      console.log(`\nNhan tin hieu ${signal}, dang tat server...`);
      stopReminderScheduler();
      stopDigestScheduler();
      stopRecurringScheduler();
      stopRiskScheduler();
      shutdownRealtime();
      server.close(() => {
        console.log('Server da dung.');
        process.exit(0);
      });
    };

    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));
  } catch (error) {
    // Thuong gap khi thieu hoac sai bien moi truong
    console.error(
      'Loi cau hinh khi khoi dong server:',
      error instanceof Error ? error.message : error
    );
    process.exit(1);
  }
}

startServer();
