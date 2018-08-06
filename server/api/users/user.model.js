const mongoose = require('mongoose');

const { Schema } = mongoose;

const userSchema = new Schema({
  googleId: String,
  displayName: String,
  profileImageUrl: String,
  email: { type: String, unique: true },
});

mongoose.model('User', userSchema);
