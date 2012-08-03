/** EVENTS
 ****************************************************************************/

function loadPlaylist(playlistId) {
    $.ajax({
        url: '/api/playlists/' + playlistId,
        type: 'GET',
        statusCode: {
            200: function(data) {
                var playlist = new Playlist(data.title, data.videos, data.remoteId, data.owner, data.isPrivate, data.followers);
                PlaylistView.loadPlaylistView(playlist);
                playlistManager.selectPlaylistByRemoteId(data.remoteId);
            },
            403: function(data) {
                alert("Looks like this playlist is private");
            },
            404: function(data) {
                alert("No such playlist found");
            }
        }
    });
}

function playlistMenuItemSelected(menuItem) {
    var playlist = menuItem.getModel();

    if (playlist.remoteId) {
        history.pushState(null, null, playlist.getUrl());
    } else {
        history.pushState(null, null, '/');
    }

    PlaylistView.loadPlaylistView(playlist);
}

/** CLASS PLAYLIST
 ****************************************************************************/

function Playlist(title, videos, remoteId, owner, isPrivate, followers) {
    var i, 
        self = this;
    self.title = title;
    self.videos = [];
    /* The loop that adds videos to self.videos is moved to the end of the class to avoid reference errors */
    self.remoteId = remoteId || null;

    self.owner = owner;
    if (owner) {
        self.owner = new User(owner);
    }

    self.isPrivate = isPrivate || false;
    self.followers = followers || [];
    self.synced = true; // not part of JSON structure
    self.syncing = false; // not part of JSON structure
    self.isSubscription = false;
    for (i = 0; i < self.followers.length; i+=1) {
        if (Number(self.followers[i].id) === Number(my_user_id)) {
            self.isSubscription = true;
            break;
        }
    }
    self.menuItem = null;
    self.$tracklist = null;

    self.getTwitterShareUrl = function() {
        var url = self.getUrl(),
            text = "Check out this playlist!" + ' -- ' + self.title;
        return encodeURI('http://twitter.com/share?related=youtify&via=youtify' + '&url=' + url + '&counturl=' + url + '&text=' + text);
    };

    self.getFacebookShareUrl = function() {
        var url = self.getUrl();
        return 'http://facebook.com/sharer.php?u=' + url;
    };

    self.getUrl = function() {
        return self.owner.getUrl() + '/playlists/' + self.remoteId;
    };

    self.copy = function() {
        return new Playlist(self.title, self.videos);
    };

    self.getMenuItem = function() {
        if (self.menuItem === null) {
            var args = {
                title: self.title,
                $contentPane: $('#right > .playlists'),
                cssClasses: ['playlistElem'],
                onSelected: playlistMenuItemSelected,
                onContextMenu: showPlaylistContextMenu,
                model: self,
            };

            if (self.isSubscription) {
                args.cssClasses.push('subscription');
                args.$img = $('<img class="owner" />').attr('src', self.owner.smallImageUrl);
            } else {
                args.cssClasses.push('droppable');
            }

            if (self.remoteId) {
                args.cssClasses.push('remote');
            } else {
                args.cssClasses.push('local');
            }

            if (self.isPrivate) {
                args.cssClasses.push('private');
            }

            self.menuItem = new MenuItem(args);
        }

        return self.menuItem;
    };

    self.getTrackList = function() {
        if (self.$tracklist === null) {
            self.$tracklist = $('<table/>')
                .addClass('pane')
                .addClass('tracklist')
                .appendTo('#right > .playlists')
                .data('model', self);
        }
        return self.$tracklist;
    };
    
    self.setAsPlaying = function() {
        self.getMenuItem().setAsPlaying();
    };

    self.rename = function(newTitle) {
        var title = $.trim(newTitle);
        if (title.length > 0 && title.length < 50) {
            self.title = newTitle;
        }
        self.synced = false;
        self.getMenuItem().setTitle(newTitle);
    };

    self.unsync = function(callback) {
        var url = '/api/playlists/' + self.remoteId;
        if (self.isSubscription) {
            url = '/api/playlists/' + self.remoteId + '/followers';
        }
        LoadingBar.show();
        $.ajax({
            type: 'DELETE',
            url: url,
            complete: function(jqXHR, textStatus) {
                LoadingBar.hide();
            },
			statusCode: {
				200: function(data) {
					if (callback) {
                        self.isSubscription = false;
						callback();
					}
				},
				404: function(data) {
					alert(TranslationSystem.translations['No such playlist found']);
				},
				409: function(data) {
                    new ReloadDialog().show();
				}
			}
        });

        if (!self.isSubscription) {
            self.remoteId = null;
            self.owner = null;
        }
    };
    
    self.subscribe = function(callback) {
        var params = {
            'device': device
        };

        self.syncing = true;
        LoadingBar.show();
        $.ajax({
            type: 'POST',
            url: '/api/playlists/' + self.remoteId + '/followers',
            data: params,
            complete: function(jqXHR, textStatus) {
                LoadingBar.hide();
            },
            statusCode: {
                200: function(data, textStatus) {
                    self.syncing = false;
                    self.isSubscription = true;
                    self.followers.push(UserManager.currentUser);
                    if (textStatus === 'success') {
                        self.synced = true;
                    } else {
                        alert('Failed to create new playlist ' + self.title);
                    }
                    self.getMenuView().addClass('remote');
                    playlistManager.addPlaylist(self);
                    Menu.addPlaylist(self);
                    if (callback) {
                        callback();
                    }
                },
                404: function(data) {
                    alert(TranslationSystem.translations['No such playlist found']);
                },
                409: function(data) {
                    new ReloadDialog().show();
                }
            }
        });
    };

    self.createNewPlaylistOnRemote = function(callback) {
        var params = {
                'json': JSON.stringify(self.toJSON()),
				'device': device
            };

        self.syncing = true;

		$.ajax({
            type: 'POST',
            url: '/api/playlists',
			data: params,
			statusCode: {
				200: function(data, textStatus) {
					self.syncing = false;
					if (textStatus === 'success') {
						self.remoteId = data.remoteId;
						self.owner = new User(data.owner);
						self.synced = true;
                    } else {
						alert('Failed to create new playlist ' + self.title);
					}
					if (callback) {
						callback();
					}
				},
				409: function(data) {
                    new ReloadDialog().show();
				}
			}
        });
    };

    self.updatePlaylistOnRemote = function(callback) {
        if (self.isSubscription) {
            return;
        }
        var params = {
                'json': JSON.stringify(self.toJSON()),
				'device': device
            };

        self.syncing = true;

		$.ajax({
            type: 'POST',
            url: '/api/playlists/' + self.remoteId,
			data: params,
			statusCode: {
				200: function(data, textStatus) {
					self.syncing = false;
					if (textStatus === 'success') {
						self.synced = true;
					} else {
						alert('Failed to create new playlist ' + self.title);
					}
					if (callback) {
						callback();
					}
				},
				404: function(data) {
					alert(TranslationSystem.translations['No such playlist found']);
				},
				409: function(data) {
                    new ReloadDialog().show();
				}
			}
        });
    };

    self.sync = function(callback) {
        if (self.remoteId && self.synced) {
            callback();
        } else if (self.remoteId) {
            self.updatePlaylistOnRemote(callback);
        } else {
            self.createNewPlaylistOnRemote(callback);
        }
    };

    self.addVideo = function(video) {
        if (self.isSubscription) {
            return;
        }
        if (self.syncing) {
            alert("Please wait until the playlist is synced");
            return;
        }

        var newVideo = video.clone();
        newVideo.onPlayCallback = self.setAsPlaying;
        self.videos.push(newVideo);

        var $video = newVideo.createListView();
        var buttons = $video.data('additionalMenuButtons') || [];
        buttons.push({
            title: 'Delete',
            cssClass: 'delete',
            args: $video,
            callback: PlaylistView.deleteVideoButtonClicked
        });
        $video.data('additionalMenuButtons', buttons);
        $video.addClass('droppable');
        $video.addClass('draggable');
        $video.addClass('reorderable');
        $video.appendTo(self.getTrackList());

        self.synced = false;
    };

    self.moveVideo = function(sourceIndex, destIndex) {
        if (self.isSubscription) {
            return;
        }
        if (self.syncing) {
            alert("Please wait until the playlist is synced");
            return;
        }

        var tmp;

        if (destIndex > sourceIndex) {
            destIndex -= 1;
        }

        tmp = self.videos.splice(sourceIndex, 1)[0];
        self.videos.splice(destIndex, 0, tmp);

        self.synced = false;
    };

    self.deleteVideo = function(index) {
        if (self.isSubscription) {
            return;
        }
        if (self.syncing) {
            alert("Please wait until the playlist is synced");
            return;
        }

        self.videos.splice(index, 1);
        self.synced = false;
    };

    self.toJSON = function() {
        return {
            title: self.title,
            videos: self.videos,
            remoteId: self.remoteId,
            owner: self.owner,
            isPrivate: self.isPrivate
        };
    };

	self.removeDuplicates = function() {
		var deleted = 0,
            i, j;
		for (i = self.videos.length-1; i > 0; i -= 1) {
			for (j = i-1; j >= 0; j -= 1) {
				if (self.videos[i].videoId === self.videos[j].videoId) {
					self.deleteVideo(j);
					deleted += 1;
					break;
				}
			}
		}
		playlistManager.save();
		PlaylistView.loadPlaylistView(self);
		return deleted;
	};

    self.goTo = function() {
        history.pushState(null, null, self.owner.getUrl() + '/playlists/' + self.remoteId);
        Menu.deSelect();
        loadPlaylist(self.remoteId);
    };

    self.getSmallView = function() {
        var $playlist = $('<span class="playlist link"></span>');

        $playlist.text(self.title);
        $playlist.click(self.goTo);

        return $playlist;
    };

    self.getSearchView = function() {
        var $playlist = $('<div class="playlist"></div>');

        $playlist.append(self.getSmallView());
        $playlist.append($('<span> by </span>'));
        $playlist.append(self.owner.getSmallView());

        return $playlist;
    };
    
    if (typeof(videos) === 'string') {
        videos = JSON.parse(videos);
    }

    for (i = 0; i < videos.length; i+= 1) {
        if (videos[i]) {
            var video = new Video({
                videoId: videos[i].videoId,
                title: videos[i].title,
                type: videos[i].type,
                duration: videos[i].duration,
                onPlayCallback: self.setAsPlaying
            });
            self.videos.push(video);
        }
    }
}
