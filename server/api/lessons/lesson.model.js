const mongoose = require('mongoose');

const { Schema } = mongoose;

const lessonSchema = new Schema({
  title: String,
  content: String,
  imageUrl: String,
  likes: Number,
  createdAt: { type: Date, default: Date.now },
  authors: [{ type: Schema.Types.ObjectId, ref: 'User' }],
});

mongoose.model('Lesson', lessonSchema);
