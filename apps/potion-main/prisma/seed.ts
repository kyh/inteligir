import { prisma } from '../src/server/db';

const seed = async () => {
  try {
    // Seeding logic goes here
    await Promise.resolve();
  } catch (error) {
    console.error(error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
};

void seed();
