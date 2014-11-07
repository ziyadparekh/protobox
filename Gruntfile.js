// Gruntfile.js

// our wrapper function (required by grunt and its plugins)
// all configuration goes inside this function
module.exports = function(grunt) {

  // ===========================================================================
  // CONFIGURE GRUNT ===========================================================
  // ===========================================================================
  grunt.initConfig({

    // get the configuration info from package.json ----------------------------
    // this way we can use things like name and version (pkg.name)
    pkg: grunt.file.readJSON('package.json'),

	 // all of our configuration will go here
   // compile less stylesheets to css -----------------------------------------
    less: {
      build: {
        files: {
          'dist/protobox/css/app.css': 'public/protobox/css/less/app.less'
        }
      }
    },
    copy: {
      main: {
        files: [
          // includes files within path
          {
            expand: true,
            flatten: true,
            src: ['views/*'],
            dest: 'dist/protobox/',
            filter: 'isFile',
            rename: function(dest, src) {
              return dest + src.replace(".ejs", "") + '.html';
            }
          },
          {
            expand: true,
            src: ['public/protobox/css/fonts/tenderness/*'],
            dest: 'dist/protobox/fonts/tenderness',
            filter: 'isFile',
            flatten: true
          },
          {
            expand: true,
            src: ['public/protobox/images/*'],
            dest: 'dist/protobox/images',
            filter: 'isFile',
            flatten: true
          }
        ]
      }
    },
    'string-replace': {
      inline: {
        files: [{
          expand: true,
          src: ['dist/protobox/*.html'],
          dest: 'dist/protobox/',
          filter: 'isFile',
          flatten: true,
        }],
        options: {
          replacements: [
            // place files inline example
            {
              pattern: '<script src="/bower_components/less/dist/less-1.7.5.js" type="text/javascript"></script>',
              replacement: ''
            },
            {
              pattern: '<script type="text/javascript"> less = { env: "development" }; </script>',
              replacement: ''
            },
            {
              pattern: '<link rel="stylesheet/less" type="text/css" href="/protobox/css/less/app.less" />',
              replacement: '<link rel="stylesheet" type="text/css" href="css/app.css" />'              
            },
            {
              pattern: '<link rel="shortcut icon" href="/protobox/images/favicon.ico" type="image/x-icon">',
              replacement: '<link rel="shortcut icon" href="images/favicon.ico" type="image/x-icon">'
            }
          ]
        }
      }
    },
    cssmin: {
      build: {
        files: {
          'dist/protobox/css/app.css': 'dist/protobox/css/app.css'
        }
      }
    }

  });

  // ===========================================================================
  // LOAD GRUNT PLUGINS ========================================================
  // ===========================================================================
  // we can only load these if they are in our package.json
  // make sure you have run npm install so our app can find these
  grunt.loadNpmTasks('grunt-contrib-less');
  grunt.loadNpmTasks('grunt-contrib-cssmin');
  grunt.loadNpmTasks('grunt-contrib-watch');
  grunt.loadNpmTasks('grunt-contrib-copy');
  grunt.loadNpmTasks('grunt-string-replace');

  grunt.registerTask('default', ['less', 'copy', 'string-replace', 'cssmin']);

};