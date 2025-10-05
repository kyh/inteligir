import { prisma } from '../src/server/db';

const seed = async () => {
  try {
    // console.info('Starting seeding...');
  } catch (error) {
    console.error(error);
    // eslint-disable-next-line unicorn/no-process-exit
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
};

void seed();
