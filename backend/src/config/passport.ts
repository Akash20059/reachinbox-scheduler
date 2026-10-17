import passport from 'passport';
import { Strategy as GoogleStrategy } from 'passport-google-oauth20';
import { prisma } from '../db/prisma.js';
import { env } from './env.js';

if (env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET) {
  passport.use(
    new GoogleStrategy(
      {
        clientID: env.GOOGLE_CLIENT_ID,
        clientSecret: env.GOOGLE_CLIENT_SECRET,
        callbackURL: env.GOOGLE_CALLBACK_URL,
      },
      async (accessToken, refreshToken, profile, done) => {
        try {
          const email = profile.emails?.[0]?.value;
          if (!email) {
            return done(new Error('No email provided by Google account'), undefined);
          }

          const name = profile.displayName || profile.name?.givenName || 'User';
          const avatar = profile.photos?.[0]?.value || null;
          const googleId = profile.id;

          const user = await prisma.user.upsert({
            where: { email },
            update: {
              name,
              avatar,
              googleId,
            },
            create: {
              email,
              name,
              avatar,
              googleId,
            },
          });

          return done(null, user);
        } catch (error) {
          return done(error as Error, undefined);
        }
      }
    )
  );
} else {
  console.warn('⚠️ Google OAuth credentials missing in .env');
}

export default passport;
