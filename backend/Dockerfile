# Backend TaskFlow - chay o che do phat trien (co tsx watch)
FROM node:20-alpine

WORKDIR /app

# Cai dependencies truoc de tan dung cache layer cua Docker
COPY package.json package-lock.json ./
RUN npm ci

# Copy phan con lai cua ma nguon
COPY . .

# Sinh Prisma Client (output vao src/generated/prisma) ngay trong image
RUN npx prisma generate

EXPOSE 4000

# Moi lan container khoi dong:
#  1) sinh lai Prisma Client (phong khi schema doi)
#  2) ap dung cac migration con thieu
#  3) chay server (tsx watch)
CMD ["sh", "-c", "npx prisma generate && npx prisma migrate deploy && npm run dev"]
