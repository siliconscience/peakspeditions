Vision: a simple blogger site

goals: allow a user to
* have an authenticaed user login experience
* passwords can be saved with a scheme like /etc/passwd, not plaintext
* each user can create multiple blogs and each blogs can contain multiple posts
* a post contains images and text
* the things a user can do are
* create a blog (a collection of posts)
* create a blog entry (a post)
* in the post, allow the addition of
** a block of text
** an image
** a table with up to three columns
** read a group of images and create a thumbnail view
*** thumbnails are sized to fit 3 side by side on a cellphone screen
*** later will add a method to reorder
**** maybe a manual bubble sort
**** maybe a drag and drop

steps:
* create a basic blog creation tool - user can give it a name and a purpose
* create a basic post creation tool - user can create a post
* allow user to enter text block on post
* allow user to add an image to post
* pause there for now

tech stack:
* node.js backend
* text and images stored as is, without a database
