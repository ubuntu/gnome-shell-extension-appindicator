#!/usr/bin/env python2
# -*- coding: utf-8 -*-

import sys
from PyQt4 import Qt
from PyQt4.QtCore import QObject, QString
from PyKDE4.kdeui import KStatusNotifierItem, KMenu


App = Qt.QApplication(sys.argv)

class Notifier(QObject):
    def __init__(self, parent=None):
        QObject.__init__(self, parent)

        self.tray = KStatusNotifierItem("ksni-test-tool", self)
        self.tray.setCategory(KStatusNotifierItem.Communications)
        self.tray.setIconByName(QString("/usr/share/icons/oxygen/16x16/categories/applications-internet.png"))
        self.tray.setAttentionIconByName(QString("accessories-text-editor"))
        self.tray.setStatus(KStatusNotifierItem.Active)
        self.tray.setToolTipIconByName(QString("/usr/share/icons/oxygen/16x16/categories/applications-internet.png"))

        self.menu = KMenu("KSNI Test Tool")
        self.menu.addAction("Hello", self.onHelloClicked)
        self.menu.addAction("Change Status", self.toggleStatus)
        self.menu.addAction("Hide for some seconds", self.hideForAWhile)
        self.menu.addAction("Switch to pixmap icon", self.usePixmap)
        self.menu.addSeparator()
        self.menu.addAction("Set overlay pixmap", self.setOverlayPixmap)
        self.menu.addAction("Set overlay icon name", self.setOverlayName)
        self.menu.addAction("Remove overlay icon", self.removeOverlay)
        self.tray.setContextMenu(self.menu)

        self.tray.activateRequested.connect(self.onActivated)
        self.tray.scrollRequested.connect(self.onScroll)

    def onActivated(self, show, point):
        print "Activate() called, show="+str(show)+", point="+str(point)

    def onScroll(self, delta, orientation):
        print "Scroll() called, delta="+str(delta)+", orientation="+str(orientation)

    def onHelloClicked(self):
        print "Hello World!"

    def toggleStatus(self):
        if (self.tray.status() == KStatusNotifierItem.Active):
            self.tray.setStatus(KStatusNotifierItem.NeedsAttention)
        else:
            self.tray.setStatus(KStatusNotifierItem.Active)

    def hideForAWhile(self):
        self.tray.setStatus(KStatusNotifierItem.Passive)
        Qt.QTimer.singleShot(2000, self.toggleStatus)

    def usePixmap(self):
        self.tray.setIconByName(QString(""))
        self.tray.setIconByPixmap(Qt.QIcon.fromTheme("accessories-calculator"))

    def setOverlayPixmap(self):
        self.tray.setOverlayIconByName(QString(""))
        self.tray.setOverlayIconByPixmap(Qt.QIcon.fromTheme("dialog-information"))

    def setOverlayName(self):
        self.tray.setOverlayIconByPixmap(Qt.QIcon())
        self.tray.setOverlayIconByName(QString("dialog-error"))

    def removeOverlay(self):
        self.tray.setOverlayIconByName(QString(""))
        self.tray.setOverlayIconByPixmap(Qt.QIcon())

if __name__ == '__main__':
    notifer = Notifier()
    App.exec_()
